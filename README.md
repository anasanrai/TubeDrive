# YouTube to Google Drive

A Next.js application that allows users to download YouTube videos and upload them directly to their Google Drive.

## Features

- 🎥 Download YouTube videos
- ☁️ Upload to Google Drive automatically
- 🔐 Secure OAuth2 authentication with Google
- 📊 Track transfer history with Supabase
- 🎨 Modern, responsive UI
- 🗜️ Video compression (requires ffmpeg - local development only)

> **Note:** The compression feature requires ffmpeg to be installed on the system. This works in local development but may not be available on Vercel's free tier due to binary size limitations.

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Google Cloud Console account
- Supabase account

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd youtube-to-drive
npm install
```

### 2. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Drive API**
4. Configure OAuth Consent Screen:
   - User Type: External
   - Add your email as a test user
5. Create OAuth 2.0 Client ID:
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (for local development)
     - `https://your-domain.vercel.app/api/auth/callback/google` (for production)
6. Copy the Client ID and Client Secret

### 3. Set Up Supabase

1. Go to [Supabase](https://supabase.com)
2. Create a new project
3. Run the SQL schema from `supabase_schema.sql` in the SQL Editor
4. Copy your project URL and anon key from Project Settings > API

### 4. Configure Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Fill in the values:

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Vercel

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com) and import your repository
3. Add the following environment variables in Vercel:
   - `NEXTAUTH_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   
   **Note:** Do NOT set `NEXTAUTH_URL` in Vercel - it will auto-detect the production URL

4. **IMPORTANT:** Add your production callback URL to Google OAuth:
   - Go to Google Cloud Console > APIs & Services > Credentials
   - Edit your OAuth 2.0 Client ID
   - Add to Authorized redirect URIs:
     ```
     https://your-domain.vercel.app/api/auth/callback/google
     ```

5. Deploy!

## Troubleshooting

### Authentication Error on Production

If you see "Server error" when clicking "Get Started":

1. Verify all environment variables are set in Vercel
2. Check that the production callback URL is added to Google OAuth credentials
3. Ensure `NEXTAUTH_SECRET` is set (do not use `NEXTAUTH_URL` in production)
4. Check Vercel deployment logs for specific errors

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Authentication:** NextAuth.js
- **Database:** Supabase
- **Styling:** Tailwind CSS
- **UI:** Framer Motion, Lucide Icons
- **APIs:** Google Drive API, YouTube

## License

MIT
