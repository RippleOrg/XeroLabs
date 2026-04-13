import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xero Labs — On-Chain NAV Oracle & Yield Aggregator",
  description: "Permissionless, composable NAV oracle and yield aggregator for tokenized RWAs on HashKey Chain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {/* Navigation */}
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">X</span>
                </div>
                <span className="font-bold text-gray-900 text-lg">Xero Labs</span>
              </a>

              <div className="flex items-center gap-6">
                <a href="/oracle" className="text-sm font-medium text-gray-600 hover:text-indigo-600">
                  Oracle
                </a>
                <a href="/vault" className="text-sm font-medium text-gray-600 hover:text-indigo-600">
                  Vault
                </a>
                <a href="/assets" className="text-sm font-medium text-gray-600 hover:text-indigo-600">
                  Assets
                </a>
                <a
                  href="https://github.com/RippleOrg/XeroLabs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-500 hover:text-gray-700"
                >
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </nav>

        {/* Page content */}
        <main>{children}</main>

        {/* Footer */}
        <footer className="border-t border-gray-200 mt-20 py-8">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-400">
            Xero Labs · HashKey Chain On-Chain Horizon Hackathon · DeFi Track
          </div>
        </footer>
      </body>
    </html>
  );
}
