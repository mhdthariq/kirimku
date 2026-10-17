import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/app/theme-provider";
import { PwaProvider } from "@/components/app/pwa";
import { AuthProvider } from "@/hooks/use-auth";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "NovaLogistik - Shipment Management",
    description:
        "Platform manajemen pengiriman end-to-end: customers, shipments, pickup, gudang, transport, delivery, tarif, invoice, dan audit trail.",
    applicationName: "NovaLogistik",
    manifest: "/manifest.webmanifest",
    icons: {
        icon: [
            {
                url: "/nova-icon-light.png",
                sizes: "180x180",
                type: "image/png",
                media: "(prefers-color-scheme: light)",
            },
            {
                url: "/nova-icon-dark.png",
                sizes: "180x180",
                type: "image/png",
                media: "(prefers-color-scheme: dark)",
            },
        ],
        apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "NovaLogistik",
    },
    formatDetection: { telephone: false },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#0d9d70" },
        { media: "(prefers-color-scheme: dark)", color: "#0a1512" },
    ],
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="id" suppressHydrationWarning>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
            >
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    <PwaProvider>
                        <AuthProvider>
                            {children}
                            <Toaster
                                richColors
                                position="top-right"
                                closeButton
                            />
                        </AuthProvider>
                    </PwaProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
