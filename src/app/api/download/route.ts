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

                // 4. Fallback: Streaming Download via yt-dlp (No Disk Usage)
                sendUpdate({ status: "downloading", message: "Starting direct stream to Drive...", progress: 0 });
                const { spawn } = await import("child_process");
                const { PassThrough } = await import("stream");

                // Create a PassThrough stream to monitor progress
                let transferred = 0;
                const progressStream = new PassThrough();
                progressStream.on('data', (chunk: any) => {
                    transferred += chunk.length;
                    // Send periodic updates (every ~5MB or similar, kept simple here)
                    if (Math.random() < 0.05) { // Throttled updates
                        sendUpdate({
                            status: "downloading",
                            message: "Streaming...",
                            transferred: transferred
                            // Note: total size is unknown in stdout stream usually, 
                            // so we rely on 'transferred' bytes
                        });
                    }
                });

                const driveUploadPromise = drive.files.create({
                    requestBody: { name: filename },
                    media: {
                        mimeType: "video/mp4",
                        body: progressStream,
                    },
                    fields: "id",
                });

                await new Promise((resolve, reject) => {
                    // Use -f best to avoid merging (merging requires disk)
                    // Use -o - to stream to stdout
                    activeProcess = spawn(YOUTUBE_DL_PATH, [
                        url,
                        "-f", "best[ext=mp4]/best",
                        "-o", "-",
                        "--no-playlist",
                        "--no-check-certificates",
                        "--buffer-size", "16K" // Smaller buffer for smoother streaming
                    ]);

                    // Pipe yt-dlp stdout -> progressStream -> Drive
                    if (activeProcess.stdout) {
                        activeProcess.stdout.pipe(progressStream);
                    }

                    let errorMsg = "";
                    if (activeProcess.stderr) {
                        activeProcess.stderr.on("data", (data: any) => {
                            errorMsg += data.toString();
                            // Optional: Try to parse progress from stderr if needed, 
                            // but reliance on stdout size is more reliable for 'transferred'
                        });
                    }

                    activeProcess.on("close", (code: any) => {
                        activeProcess = null;
                        if (code === 0) resolve(null);
                        else reject(new Error(`Stream failed: ${errorMsg.slice(0, 200)}`));
                    });

                    // Handle stream errors
                    activeProcess.stdout.on('error', (err: any) => reject(err));
                });

                const driveResponse = await driveUploadPromise;

                // Log to Supabase
                await supabase.from('transfers').insert({
                    user_email: session.user.email,
                    type: 'download',
                    title: title,
                    original_size: transferred,
                    final_size: transferred,
                    status: 'success',
                    drive_file_id: driveResponse.data.id
                });

                sendUpdate({ status: "success", fileId: driveResponse.data.id, message: "Successfully saved to Drive!" });
                safeClose();

            } catch (error: any) {
                console.error("Streaming Error:", error);
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
