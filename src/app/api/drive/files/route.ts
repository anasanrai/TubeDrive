import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions) as any;

    if (!session || !session.accessToken) {
        console.warn("[Drive API] Unauthorized: No session or accessToken found.");
        return NextResponse.json({ error: "Unauthorized: Please sign in." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";

    // Initialize OAuth2 client with tokens
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ access_token: session.accessToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    try {
        // Query for video files.
        const query = q
            ? `mimeType contains 'video/' and name contains '${q.replace(/'/g, "\\'")}' and trashed = false`
            : "mimeType contains 'video/' and trashed = false";

        console.log(`[Drive API] Fetching files with query: ${query}`);

        const response = await drive.files.list({
            q: query,
            fields: "files(id, name, size, mimeType, thumbnailLink)",
            pageSize: 50, // Increased to see more files
            orderBy: "modifiedTime desc", // Show newest first
        });

        console.log(`[Drive API] Found ${response.data.files?.length || 0} files.`);

        return NextResponse.json({ files: response.data.files || [] });
    } catch (error: any) {
        console.error("[Drive API Error]:", error.message);

        if (error.code === 401 || error.message.includes("invalid authentication credentials")) {
            console.error("[Drive API Error] AUTH FAILURE: The token is invalid or lacks the required scope.");
            return NextResponse.json({
                error: "Authentication failed. You MUST sign out and sign back in to grant new permissions.",
                suggestion: "signOut"
            }, { status: 401 });
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
