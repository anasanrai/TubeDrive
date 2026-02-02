import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import os from "os";
import { supabase } from "@/lib/supabase";

const YOUTUBE_DL_PATH = "/opt/homebrew/bin/yt-dlp";

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
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    activeTransfers++;

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
                sendUpdate({ status: "initializing", message: "Activating Light Speed Tunnel..." });

                // 1. Get Video Metadata & Direct URL
                const info: any = await new Promise((resolve, reject) => {
                    const { spawn } = require("child_process");
                    activeProcess = spawn(YOUTUBE_DL_PATH, [
                        url,
                        "--dump-single-json",
                        "--no-check-certificates",
                        "-f", "best[ext=mp4]"
                    ]);

                    let stdout = "";
                    let stderr = "";
                    activeProcess.stdout.on("data", (data: Buffer) => stdout += data.toString());
                    activeProcess.stderr.on("data", (data: Buffer) => stderr += data.toString());

                    activeProcess.on("close", (code: number | null) => {
                        activeProcess = null;
                        if (code === 0) {
                            try {
                                resolve(JSON.parse(stdout));
                            } catch (e) {
                                reject(new Error("Failed to parse video metadata"));
                            }
                        } else {
                            reject(new Error(`Metadata fetch failed: ${stderr.slice(0, 100)}`));
                        }
                    });
                });

                const title = info.title || "video";
                const filename = `${title}.mp4`.replace(/[/\\?%*:|"<>]/g, "-");
                const directUrl = info.url;

                // 2. Initialize Google Drive
                const auth = new google.auth.OAuth2();
                auth.setCredentials({ access_token: session.accessToken as string });
                const drive = google.drive({ version: "v3", auth });

                // 3. Attempt "Light Speed" Direct Pipe
                if (directUrl && !directUrl.includes("manifest")) {
                    sendUpdate({
                        status: "tunneling",
                        message: "🚀 Streaming via Light Speed Tunnel...",
                        progress: 0,
                        totalSize: parseInt(info.filesize || info.filesize_approx || "0")
                    });

                    const response = await fetch(directUrl);
                    if (!response.ok) throw new Error(`Source stream failed: ${response.statusText}`);

                    const totalSize = parseInt(response.headers.get("content-length") || "0");
                    const nodeStream = require("stream").Readable.fromWeb(response.body as any);

                    let uploaded = 0;
                    const progressStream = new (require("stream").Transform)({
                        transform(chunk: any, encoding: any, callback: any) {
                            uploaded += chunk.length;
                            if (totalSize > 0) {
                                const prog = Math.round((uploaded / totalSize) * 100);
                                if (prog % 5 === 0) {
                                    sendUpdate({
                                        status: "tunneling",
                                        message: "🚀 Streaming via Light Speed Tunnel...",
                                        progress: prog,
                                        transferred: uploaded,
                                        total: totalSize
                                    });
                                }
                            }
                            callback(null, chunk);
                        }
                    });

                    const driveResponse = await drive.files.create({
                        requestBody: { name: filename },
                        media: {
                            mimeType: "video/mp4",
                            body: nodeStream.pipe(progressStream),
                        },
                        fields: "id",
                    });

                    // Log to Supabase
                    await supabase.from('transfers').insert({
                        user_email: session.user.email,
                        type: 'download',
                        title: title,
                        original_size: totalSize,
                        final_size: totalSize,
                        status: 'success',
                        drive_file_id: driveResponse.data.id
                    });

                    sendUpdate({ status: "success", fileId: driveResponse.data.id, message: "Successfully saved to Drive!" });
                    safeClose();
                    return;
                }

                // 4. Fallback: High-Concurrency Download
                sendUpdate({ status: "downloading", message: "Direct tunnel unavailable. Using high-concurrency download...", progress: 0 });
                const tmpPath = path.join(os.tmpdir(), filename);
                const { spawn } = await import("child_process");

                await new Promise((resolve, reject) => {
                    activeProcess = spawn(YOUTUBE_DL_PATH, [
                        url,
                        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                        "-o", tmpPath,
                        "--concurrent-fragments", "16",
                        "--buffer-size", "10M",
                        "--no-mtime",
                        "--progress",
                        "--newline"
                    ]);

                    activeProcess.stdout.on("data", (data: any) => {
                        const line = data.toString();
                        const match = line.match(/(\d+\.\d+)%/);
                        if (match) {
                            const progress = parseFloat(match[1]);
                            sendUpdate({
                                status: "downloading",
                                message: `Fast Download: ${Math.round(progress)}%`,
                                progress: Math.min(Math.round(progress), 100)
                            });
                        }
                    });

                    let errorMsg = "";
                    activeProcess.stderr.on("data", (data: any) => errorMsg += data.toString());

                    activeProcess.on("close", (code: any) => {
                        activeProcess = null;
                        if (code === 0) resolve(null);
                        else reject(new Error(`Download failed: ${errorMsg.slice(0, 100)}`));
                    });
                });

                // Upload the fast-downloaded file
                sendUpdate({ status: "uploading", message: "Pushing to Drive...", progress: 0 });
                const fileSize = fs.statSync(tmpPath).size;
                const driveResponse = await drive.files.create({
                    requestBody: { name: filename },
                    media: {
                        mimeType: "video/mp4",
                        body: fs.createReadStream(tmpPath),
                    },
                    fields: "id",
                }, {
                    onUploadProgress: (evt) => {
                        sendUpdate({
                            status: "uploading",
                            message: "Pushing to Drive...",
                            progress: Math.round((evt.bytesRead / fileSize) * 100),
                            transferred: evt.bytesRead,
                            total: fileSize
                        });
                    }
                });

                // Log to Supabase
                await supabase.from('transfers').insert({
                    user_email: session.user.email,
                    type: 'download',
                    title: title,
                    original_size: fileSize,
                    final_size: fileSize,
                    status: 'success',
                    drive_file_id: driveResponse.data.id
                });

                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                sendUpdate({ status: "success", fileId: driveResponse.data.id, message: "Successfully saved to Drive!" });
                safeClose();

            } catch (error: any) {
                console.error("Light Speed Error:", error);
                sendUpdate({ status: "error", message: error.message || "An unexpected error occurred" });
                safeClose();
            } finally {
                activeTransfers--;
                if (activeProcess) {
                    try { activeProcess.kill(); } catch (e) { }
                    activeProcess = null;
                }
            }
        },
        cancel() {
            if (activeProcess) {
                console.log("Cancelling active process due to client disconnect");
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
