import './globals.css';
import ToastProvider from '@/components/toast-provider';

export const metadata = {
  title: 'Procview',
  description: 'Unified Process Dashboard',
  icons: {
    icon: [
      {
        url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%232B037A"/><text x="16" y="23" font-size="18" font-weight="bold" text-anchor="middle" fill="white">PV</text></svg>',
        type: 'image/svg+xml',
      },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
