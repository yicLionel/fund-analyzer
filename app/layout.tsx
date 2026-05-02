import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '公募基金走势分析助手',
  description: '基于真实、可验证公开数据的中国公募基金走势分析网页。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
