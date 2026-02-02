import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import { supabase } from "@/lib/supabase";

const FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg";

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);

    if (!session || !session.accessToken || !session.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

                sendUpdate({ status: "downloading", message: "Fetching video from Drive...", total: totalSize });

                // 3. Download to temp file
                const tmpInputPath = path.join(os.tmpdir(), `input-${Date.now()}-${originalName}`);
                const tmpOutputPath = path.join(os.tmpdir(), `output-${Date.now()}-${finalName}`);

                const dest = fs.createWriteStream(tmpInputPath);
                const driveRes = await drive.files.get(
                    { fileId, alt: "media" },
                    { responseType: "stream" }
                );

                let downloaded = 0;
                await new Promise((resolve, reject) => {
                    (driveRes.data as any)
                        .on("data", (chunk: any) => {
                            downloaded += chunk.length;
                            if (totalSize > 0) {
                                const prog = Math.round((downloaded / totalSize) * 50); // Down = 50%
                                if (prog % 5 === 0) sendUpdate({ status: "downloading", message: `Downloading: ${Math.round((downloaded / totalSize) * 100)}%`, progress: prog / 2 });
                            }
                        })
                        .on("error", reject)
                        .pipe(dest)
                        .on("finish", resolve)
                        .on("error", reject);
                });

                sendUpdate({ status: "compressing", message: "Super Compressing (High Performance)...", progress: 50 });

                // 4. Run FFmpeg with dynamic quality settings
                await new Promise((resolve, reject) => {
                    const ffmpegArgs = [
                        "-i", tmpInputPath,
                        "-vcodec", "libx264",
                        "-crf", quality.toString(), // 18 (Best) to 35 (Worst)
                        "-preset", "veryfast",
                        "-acodec", "aac",
                        "-b:a", "128k",
                    ];

                    if (resolution !== "original") {
                        ffmpegArgs.push("-vf", `scale=-2:${resolution}`);
                    }

                    ffmpegArgs.push("-y", tmpOutputPath);

                    activeProcess = spawn(FFMPEG_PATH, ffmpegArgs);

                    activeProcess.stderr.on("data", (data: any) => {
                        // Optional: parse FFmpeg progress here
                    });

                    activeProcess.on("close", (code: any) => {
                        activeProcess = null;
                        if (code === 0) resolve(null);
                        else reject(new Error(`Compression failed with code ${code}`));
                    });
                });

                sendUpdate({ status: "uploading", message: "Saving compressed video back to Drive...", progress: 80 });

                // 5. Upload back to Drive
                const outputSize = fs.statSync(tmpOutputPath).size;
                const driveResponse = await drive.files.create({
                    requestBody: { name: finalName },
                    media: {
                        mimeType: "video/mp4",
                        body: fs.createReadStream(tmpOutputPath),
                    },
                    fields: "id",
                });

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

                // 6. Cleanup
                if (fs.existsSync(tmpInputPath)) fs.unlinkSync(tmpInputPath);
                if (fs.existsSync(tmpOutputPath)) fs.unlinkSync(tmpOutputPath);

                sendUpdate({
                    status: "success",
                    fileId: driveResponse.data.id,
                    message: "Successfully compressed and saved!",
                    originalSize: totalSize,
                    compressedSize: outputSize
                });
                safeClose();

            } catch (error: any) {
                console.error("Compression Error:", error);
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
