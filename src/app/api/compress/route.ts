import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import { spawn } from "child_process";
import { supabase } from "@/lib/supabase";

// Try to use system ffmpeg (works locally, not on Vercel)
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken || !session.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if we're on Vercel (compression not supported due to ffmpeg binary requirements)
    if (process.env.VERCEL) {
        return NextResponse.json({
            error: "🚫 Video compression is not available on this deployment.\n\nCompression requires ffmpeg, which isn't supported on Vercel's serverless platform.\n\n✅ The download feature works perfectly!\n\n💡 Tip: You can download videos and compress them locally, or use a different hosting platform for compression."
        }, { status: 503 });
    }

    const { fileId, newName, quality = 28, resolution = "original" } = await req.json();

    if (!fileId) {
        return NextResponse.json({ error: "File ID is required" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    let activeProcess: any = null;

    const stream = new ReadableStream({
        async start(controller) {
            let isClosed = false;
            const sendUpdate = (data: any) => {
                if (isClosed) return;
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
                } catch (e: any) {
                    if (e.code === 'ERR_INVALID_STATE' || (e.message && e.message.includes('closed'))) {
                        isClosed = true;
                    } else {
                        console.error("Failed to send update:", e);
                    }
                }
            };

            const safeClose = () => {
                if (!isClosed) {
                    isClosed = true;
                    try { controller.close(); } catch (e) { }
                }
            };

            try {
                sendUpdate({ status: "initializing", message: "Preparing Super Compressor..." });

                // 1. Initialize Drive
                const auth = new google.auth.OAuth2();
                auth.setCredentials({ access_token: session.accessToken as string });
                const drive = google.drive({ version: "v3", auth });

                // 2. Get file metadata
                const fileMeta = await drive.files.get({
                    fileId,
                    fields: "name,size,mimeType",
                });

                const originalName = fileMeta.data.name || "video.mp4";
                const totalSize = parseInt(fileMeta.data.size || "0");
                const finalName = newName ? (newName.endsWith(".mp4") ? newName : `${newName}.mp4`) : `compressed-${originalName}`;

                sendUpdate({ status: "streaming", message: "Starting streaming compression (no disk usage)...", progress: 0 });

                // 3. Stream from Drive (NO disk write)
                const driveRes = await drive.files.get(
                    { fileId, alt: "media" },
                    { responseType: "stream" }
                );

                const { PassThrough } = await import("stream");
                const inputStream = driveRes.data as any;

                // Monitor input download progress
                let downloaded = 0;
                const downloadMonitor = new PassThrough();
                downloadMonitor.on('data', (chunk: any) => {
                    downloaded += chunk.length;
                    if (totalSize > 0 && Math.random() < 0.1) {
                        sendUpdate({
                            status: "downloading",
                            message: `Fetching: ${Math.round((downloaded / totalSize) * 100)}%`,
                            progress: Math.round((downloaded / totalSize) * 30)
                        });
                    }
                });

                inputStream.pipe(downloadMonitor);

                sendUpdate({ status: "compressing", message: "🚀 Streaming through Super Compressor...", progress: 30 });

                // 4. Setup FFmpeg with stdin/stdout streaming (NO disk usage)
                const ffmpegArgs = [
                    "-i", "pipe:0", // Read from stdin
                    "-vcodec", "libx264",
                    "-crf", quality.toString(), // 18 (Best) to 35 (Worst)
                    "-preset", "ultrafast", // Must be fast for streaming
                    "-acodec", "aac",
                    "-b:a", "128k",
                    "-movflags", "frag_keyframe+empty_moov", // Critical for streaming output
                    "-f", "mp4", // Force MP4 format
                ];

                if (resolution !== "original") {
                    ffmpegArgs.push("-vf", `scale=-2:${resolution}`);
                }

                ffmpegArgs.push("pipe:1"); // Write to stdout

                activeProcess = spawn(FFMPEG_PATH, ffmpegArgs);

                // Pipe: Drive → FFmpeg stdin
                downloadMonitor.pipe(activeProcess.stdin);

                // Monitor FFmpeg stderr for progress/errors
                let ffmpegLog = "";
                activeProcess.stderr.on("data", (data: any) => {
                    ffmpegLog += data.toString();
                    // Optional: Parse ffmpeg progress from stderr
                    const durationMatch = ffmpegLog.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
                    const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
                    if (durationMatch && timeMatch) {
                        const totalSeconds = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
                        const currentSeconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
                        if (totalSeconds > 0) {
                            const compressProg = Math.round((currentSeconds / totalSeconds) * 100);
                            sendUpdate({
                                status: "compressing",
                                message: `Compressing: ${compressProg}%`,
                                progress: 30 + Math.round(compressProg * 0.5)
                            });
                        }
                    }
                });

                // Monitor output size
                let outputSize = 0;
                const outputMonitor = new PassThrough();
                outputMonitor.on('data', (chunk: any) => {
                    outputSize += chunk.length;
                });

                // Pipe: FFmpeg stdout → Drive
                activeProcess.stdout.pipe(outputMonitor);

                sendUpdate({ status: "uploading", message: "Streaming to Drive...", progress: 80 });

                // 5. Upload compressed stream to Drive (NO disk write)
                const driveUploadPromise = drive.files.create({
                    requestBody: { name: finalName },
                    media: {
                        mimeType: "video/mp4",
                        body: outputMonitor,
                    },
                    fields: "id",
                });

                // Wait for FFmpeg to finish processing
                await new Promise((resolve, reject) => {
                    activeProcess.on("close", (code: any) => {
                        activeProcess = null;
                        if (code === 0) {
                            sendUpdate({ status: "finalizing", message: "Finalizing upload...", progress: 95 });
                            resolve(null);
                        } else {
                            reject(new Error(`FFmpeg failed: ${ffmpegLog.slice(-500)}`));
                        }
                    });
                    activeProcess.on("error", reject);
                });

                // Wait for Drive upload to complete
                const driveResponse = await driveUploadPromise;

                // Log to Supabase
                await supabase.from('transfers').insert({
                    user_email: session.user.email,
                    type: 'compress',
                    title: finalName,
                    original_size: totalSize,
                    final_size: outputSize,
                    status: 'success',
                    drive_file_id: driveResponse.data.id
                });

                sendUpdate({
                    status: "success",
                    fileId: driveResponse.data.id,
                    message: "Successfully compressed and saved!",
                    originalSize: totalSize,
                    compressedSize: outputSize,
                    savings: totalSize > 0 ? Math.round(((totalSize - outputSize) / totalSize) * 100) : 0
                });
                safeClose();

            } catch (error: any) {
                console.error("Streaming Compression Error:", error);
                sendUpdate({ status: "error", message: error.message || "Compression failed" });
                safeClose();
            } finally {
                if (activeProcess) {
                    try { activeProcess.kill(); } catch (e) { }
                    activeProcess = null;
                }
            }
        },
        cancel() {
            if (activeProcess) {
                console.log("Cancelling compression process due to client disconnect");
                try { activeProcess.kill(); } catch (e) { }
                activeProcess = null;
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    });
}
