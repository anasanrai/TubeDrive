'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ErrorContent() {
            const searchParams = useSearchParams();
            const error = searchParams?.get('error');

    const errorMessages: Record<string, string> = {
                    Configuration: 'There is a problem with the server configuration. Please contact support.',
                    AccessDenied: 'You do not have permission to sign in.',
                    Verification: 'The verification link may have expired or has already been used.',
                    Default: 'An error occurred during authentication. Please try again.',
    };

    const errorMessage = error ? errorMessages[error] || errorMessages.Default : errorMessages.Default;

    return (
                    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
                                <div className="max-w-md w-full bg-white/10 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/20">
                                                <div className="text-center">
                                                                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-500/20 mb-4">
                                                                                            <span className="text-4xl text-red-400">!</span>span>
                                                                    </div>div>
                                                                    <h1 className="text-2xl font-bold text-white mb-2">Authentication Error</h1>h1>
                                                                    <p className="text-gray-300 mb-6">{errorMessage}</p>p>
                                                        {error && (
                                                    <p className="text-sm text-gray-400 mb-6">
                                                                                Error code: <code className="bg-black/30 px-2 py-1 rounded">{error}</code>code>
                                                    </p>p>
                                                                    )}
                                                                    <Link
                                                                                                    href="/"
                                                                                                    className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 transition-all duration-200"
                                                                                                >
                                                                                            Return to Home
                                                                    </Link>Link>
                                                </div>div>
                                </div>div>
                    </div>div>
                );
}

export default function AuthError() {
            return (
                            <Suspense fallback={
                                                <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
                                                                <div className="text-white">Loading...</div>div>
                                                </div>div>
                                    }>
                                        <ErrorContent />
                            </Suspense>Suspense>
                        );
}</div>
