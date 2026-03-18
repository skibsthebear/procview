import './globals.css';
import ToastProvider from '@/components/toast-provider';

export const metadata = {
  title: 'PM2 UI',
  description: 'PM2 Process Management Dashboard',
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
