import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Aspiro',
  description: 'Terms of Service for Aspiro - FIRE Tracker',
};

export default function TermsOfServicePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: April 25, 2026</p>

      <div className="prose prose-gray dark:prose-invert max-w-none space-y-8 text-gray-700 dark:text-gray-300">

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Aspiro (&quot;the Service&quot;) at{' '}
            <a href="https://home.aspiro.dev" className="text-blue-600 dark:text-blue-400 hover:underline">
              home.aspiro.dev
            </a>
            , you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use
            the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">2. Description of Service</h2>
          <p>
            Aspiro is a personal finance tracking application that helps users pursue Financial Independence and Early
            Retirement (FIRE). The Service provides tools for tracking expenses, investments, savings goals, and
            financial progress. Aspiro is a personal productivity tool and does not provide professional financial,
            investment, tax, or legal advice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">3. User Accounts</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>You must provide accurate and complete information when creating an account.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You must notify us immediately of any unauthorized access to your account.</li>
            <li>You may not share your account or allow others to use your credentials.</li>
            <li>We reserve the right to suspend or terminate accounts that violate these Terms.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">4. Acceptable Use</h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure.</li>
            <li>Reverse engineer, decompile, or attempt to extract the source code of the Service.</li>
            <li>Upload or transmit malicious code, viruses, or any harmful content.</li>
            <li>Use the Service to send spam or unsolicited communications.</li>
            <li>Interfere with or disrupt the integrity or performance of the Service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">5. Financial Information Disclaimer</h2>
          <p>
            Aspiro is a personal finance tracking tool only. The information, calculations, and projections provided
            by the Service are for informational and organizational purposes only. They do not constitute financial
            advice, investment recommendations, or professional guidance. Always consult a qualified financial
            professional before making investment or financial decisions. We are not responsible for any financial
            losses or decisions made based on information in the app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">6. Your Data</h2>
          <p>
            You retain ownership of all financial data you enter into Aspiro. By using the Service, you grant us a
            limited license to store and process your data solely to provide the Service to you. We do not sell your
            data or use it for advertising purposes. See our{' '}
            <a href="/privacy" className="text-blue-600 dark:text-blue-400 hover:underline">
              Privacy Policy
            </a>{' '}
            for full details on how we handle your data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">7. Intellectual Property</h2>
          <p>
            The Aspiro name, logo, design, and all content within the Service (excluding your personal data) are owned
            by or licensed to us. You may not use, copy, or distribute any part of the Service without our prior
            written permission.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">8. Service Availability</h2>
          <p>
            We strive to keep Aspiro available and reliable, but we do not guarantee uninterrupted or error-free
            access. We may modify, suspend, or discontinue the Service (or any part of it) at any time with or without
            notice. We are not liable for any loss or inconvenience caused by downtime or service interruptions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">9. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, Aspiro and its operators shall not be liable for any indirect,
            incidental, special, consequential, or punitive damages, including loss of data, profits, or financial
            losses, arising from your use of or inability to use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">10. Termination</h2>
          <p>
            You may stop using the Service and delete your account at any time. We may suspend or terminate your
            access if you violate these Terms. Upon termination, your right to use the Service ceases immediately,
            and we may delete your data in accordance with our data retention policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">11. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of material changes via email or a
            prominent notice within the app. Continued use of the Service after changes take effect constitutes
            your acceptance of the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">12. Governing Law</h2>
          <p>
            These Terms are governed by applicable law. Any disputes arising from these Terms or your use of the
            Service shall be resolved through good-faith negotiation between the parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">13. Contact Us</h2>
          <p>
            If you have questions about these Terms of Service, please contact us at{' '}
            <a href="mailto:scdev0210@gmail.com" className="text-blue-600 dark:text-blue-400 hover:underline">
              scdev0210@gmail.com
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
