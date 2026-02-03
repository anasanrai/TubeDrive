import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import { supabase } from "@/lib/supabase";
import ytdl from "@distube/ytdl-core";

let activeTransfers = 0;
const MAX_CONCURRENT_TRANSFERS = 5;

export async function POST(req: NextRequest) {
    if (activeTransfers >= MAX_CONCURRENT_TRANSFERS) {
        return NextResponse.json({ error: "Server is busy. Please try again in a few minutes." }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken || !session.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { url } = await req.json();
    if (!url) {
        return NextResponse.json({ error: "YouTube URL is required" }, { status: 400 });
    }

    activeTransfers++;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendUpdate = (data: any) => {
                controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
            };

            const safeClose = () => {
                try {
                    controller.close();
                } catch (e) {
                    // Already closed
                }
                activeTransfers--;
            };

            try {
                sendUpdate({ status: "initializing", message: "Activating Light Speed Tunnel..." });

                // Validate YouTube URL
                if (!ytdl.validateURL(url)) {
                    throw new Error("Invalid YouTube URL");
                }

                // Get video info
                sendUpdate({ status: "fetching", message: "Fetching video information...", progress: 10 });
                const info = await ytdl.getInfo(url);
                const title = info.videoDetails.title || "video";
                const filename = `${title}.mp4`.replace(/[/\\?%*:|"<>]/g, "-");

                // Initialize Google Drive
                const auth = new google.auth.OAuth2();
                auth.setCredentials({ access_token: session.accessToken as string });
                const drive = google.drive({ version: "v3", auth });

                sendUpdate({ status: "downloading", message: "Streaming video to Drive...", progress: 20 });

                // Choose the best format (highest quality mp4 video+audio)
                const format = ytdl.chooseFormat(info.formats, {
                    quality: 'highestvideo',
                    filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio
                }) || ytdl.chooseFormat(info.formats, { quality: 'highest' });

                // Create download stream
                const videoStream = ytdl.downloadFromInfo(info, { format });

                // Track progress
                let downloaded = 0;
                const contentLength = parseInt(format.contentLength || '0');

                videoStream.on('progress', (chunkLength, downloadedBytes, totalBytes) => {
                    downloaded = downloadedBytes;
                    const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 70) + 20 : 50;
                    if (Math.random() < 0.1) { // Throttle updates
                        sendUpdate({
                            status: "downloading",
                            message: `Streaming: ${Math.round((downloadedBytes / totalBytes) * 100)}%`,
                            progress,
                            transferred: downloadedBytes,
                            total: totalBytes
                        });
                    }
                });

                videoStream.on('error', (error) => {
                    throw new Error(`Stream error: ${error.message}`);
                });

                // Upload to Google Drive
                sendUpdate({ status: "uploading", message: "Saving to Drive...", progress: 90 });

                const driveResponse = await drive.files.create({
                    requestBody: { name: filename },
                    media: {
                        mimeType: "video/mp4",
                        body: videoStream,
                    },
                    fields: "id",
                });

                // Log to Supabase
                await supabase.from('transfers').insert({
                    user_email: session.user.email,
                    type: 'download',
                    title: filename,
                    original_size: contentLength,
                    final_size: contentLength,
                    status: 'success',
                    drive_file_id: driveResponse.data.id
                });

                sendUpdate({
                    status: "success",
                    fileId: driveResponse.data.id,
                    message: "Successfully saved to Drive!",
                    progress: 100
                });
                safeClose();

            } catch (error: any) {
                console.error("Streaming Error:", error);
                sendUpdate({
                    status: "error",
                    message: error.message || "Download failed. Please check the URL and try again."
                });
                safeClose();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}

export async function DELETE(req: NextRequest) {
    // Cancel is handled client-side by aborting the fetch
    return NextResponse.json({ success: true });
}
