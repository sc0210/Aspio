import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Aspiro',
  description: 'Privacy Policy for Aspiro - FIRE Tracker',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: April 25, 2026</p>

      <div className="prose prose-gray dark:prose-invert max-w-none space-y-8 text-gray-700 dark:text-gray-300">

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">1. Introduction</h2>
          <p>
            Aspiro (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates a personal finance tracking application designed to help users pursue
            Financial Independence and Early Retirement (FIRE). This Privacy Policy explains how we collect, use, and
            protect your personal information when you use our service at{' '}
            <a href="https://home.aspiro.dev" className="text-blue-600 dark:text-blue-400 hover:underline">
              home.aspiro.dev
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">2. Information We Collect</h2>
          <p className="mb-3">We collect the following types of information:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Account information:</strong> Your name and email address, provided directly or via Google Sign-In.
            </li>
            <li>
              <strong>Financial data:</strong> Transactions, investment holdings, goals, and budget information you enter
              into the app.
            </li>
            <li>
              <strong>Usage data:</strong> Pages visited, features used, and interactions within the app, collected to
              improve our service.
            </li>
            <li>
              <strong>Device information:</strong> Browser type, operating system, and IP address for security and
              analytics purposes.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">3. How We Use Your Information</h2>
          <p className="mb-3">We use your information to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Provide, operate, and maintain the Aspiro application.</li>
            <li>Authenticate your identity and secure your account.</li>
            <li>Personalize your financial dashboard and tracking experience.</li>
            <li>Send important account and service notifications.</li>
            <li>Analyze usage patterns to improve the application.</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">4. Google Sign-In</h2>
          <p>
            We offer Google Sign-In as an authentication option. When you sign in with Google, we receive your name and
            email address from Google. We do not receive access to your Google account beyond what is necessary for
            authentication. Your use of Google Sign-In is also governed by{' '}
            <a
              href="https://policies.google.com/privacy"
              className="text-blue-600 dark:text-blue-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google&apos;s Privacy Policy
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">5. Data Sharing</h2>
          <p className="mb-3">
            We do not sell, trade, or rent your personal information to third parties. We may share data with:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Service providers:</strong> Trusted third-party services that help us operate our application
              (e.g., hosting, database, analytics), bound by confidentiality agreements.
            </li>
            <li>
              <strong>Legal requirements:</strong> If required by law, court order, or governmental authority.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">6. Data Security</h2>
          <p>
            We implement industry-standard security measures to protect your data, including encrypted connections (HTTPS),
            hashed passwords, and secure database storage. However, no method of transmission over the internet is 100%
            secure, and we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">7. Data Retention</h2>
          <p>
            We retain your personal data for as long as your account is active. You may request deletion of your account
            and associated data at any time by contacting us. We will delete your data within 30 days of a verified
            deletion request.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">8. Your Rights</h2>
          <p className="mb-3">You have the right to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Access the personal data we hold about you.</li>
            <li>Correct inaccurate data.</li>
            <li>Request deletion of your data.</li>
            <li>Export your data in a portable format.</li>
            <li>Withdraw consent for optional data processing at any time.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">9. Cookies and Analytics</h2>
          <p>
            We use cookies and similar tracking technologies to maintain your session and understand how the app is used.
            You can manage cookie preferences through the consent banner displayed when you first visit the app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of significant changes via email or
            a prominent notice within the app. Continued use of the app after changes constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">11. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy or how we handle your data, please contact us at{' '}
            <a href="mailto:scdev0210@gmail.com" className="text-blue-600 dark:text-blue-400 hover:underline">
              scdev0210@gmail.com
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
