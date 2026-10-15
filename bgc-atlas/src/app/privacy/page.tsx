import type { Metadata } from 'next'
import { MainLayout } from '@/components/layout/main-layout'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy policy for BGC Atlas: data collection, cookies, request tracking, and user rights.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Privacy Policy
          </h1>
        </header>
        <div className="prose prose-sm lg:prose-base max-w-none text-foreground">
              <p className="mb-4">Our services are provided by the University of Tübingen, Geschwister-Scholl-Platz, 72074 Tübingen, Germany. This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">What data do we collect?</h3>
              <p className="mb-4">We collect several different types of information for various purposes to provide and improve our Service to you.</p>
              <p className="mb-2"><strong>Personal Information Provided by You.</strong> We collect information that you provide to us when you use our services, or when you contact us. This information may include the following:</p>
              <ul className="mb-4">
                <li>Email addresses. We collect email addresses when you submit jobs through our webservices in order to inform you about the status of your job.</li>
                <li>Feedback. When you send feedback through the form on this site, we store your message and the page you sent it from. An email address is optional; if you give one, we use it only to reply.</li>
              </ul>
              <p className="mb-4">We do not collect or store any other personal information including sensitive information.</p>

              <p className="mb-4"><strong>Information automatically collected.</strong> We automatically collect certain information when you visit, use or navigate the website. This information does not reveal your specific identity (like your name or contact information) but may include device and usage information, such as your IP address, browser and device characteristics, operating system, language preferences, referring URLs, device name, country, location, information about how and when you use our website and other technical information. This information is primarily needed to maintain the security and operation of our website, and for our internal analytics and reporting purposes. This information is not shared with third parties. This information may include the following:</p>
              <ul className="mb-4">
                <li>Log and Usage Data. Log and usage data is service-related, diagnostic usage and performance information our servers automatically collect when you access or use our website and which we record in log files. Depending on how you interact with us, this log data may include your IP address, device information, browser type and settings and information about your activity in the website (such as the date/time stamps associated with your usage, pages and files viewed, searches and other actions you take such as which features you use), device event information (such as system activity, error reports (sometimes called &apos;crash dumps&apos;) and hardware settings).</li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">How will we use your data?</h3>
              <p className="mb-2">We use the information we collect or receive:</p>
              <ul className="mb-4">
                <li>Email you about the status of your job submission(s).</li>
                <li>Reply to feedback you send us.</li>
                <li>To provide and maintain our Service, including to monitor the usage of our Service.</li>
              </ul>
              <p className="mb-4">We do not share your personal information with third parties.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">How do we store your data?</h3>
              <p className="mb-4">We store your data on secure servers located at the University of Tübingen, Germany.</p>
              <p className="mb-4">We will keep your information (such as email addresses) for as long as necessary to provide you with our services, and at most for 90 days, after which it will be deleted.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">Marketing</h3>
              <p className="mb-4">We do not use your personal information for marketing purposes.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">What are your data protection rights?</h3>
              <p className="mb-2">We would like to make sure you are fully aware of all of your data protection rights. Every user is entitled to the following:</p>
              <p className="mb-2"><strong>The right to access.</strong> You have the right to request copies of your personal data.</p>
              <p className="mb-2"><strong>The right to rectification.</strong> You have the right to request that we correct any information you believe is inaccurate. You also have the right to request that we complete the information you believe is incomplete.</p>
              <p className="mb-2"><strong>The right to erasure.</strong> You have the right to request that we erase your personal data, under certain conditions.</p>
              <p className="mb-2"><strong>The right to restrict processing.</strong> You have the right to request that we restrict the processing of your personal data, under certain conditions.</p>
              <p className="mb-2"><strong>The right to object to processing.</strong> You have the right to object to our processing of your personal data, under certain conditions.</p>
              <p className="mb-2"><strong>The right to data portability.</strong> You have the right to request that we transfer the data that we have collected to another organization, or directly to you, under certain conditions.</p>
              <p className="mb-4">If you make a request, we have one month to respond to you. If you would like to exercise any of these rights, please contact us at our email: nadine.ziemert@uni-tuebingen.de <br/> Call us at: +49 (0) 7071 2978841 <br/> Or write to us: Auf der Morgenstelle 24, 72076, Tübingen, Germany.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">Cookies</h3>
              <p className="mb-4">Cookies are text files placed on your computer to collect standard Internet log information and visitor behavior information. When you visit our websites, we may collect information from you automatically through cookies or similar technology.</p>
              <p className="mb-4">For further information, visit allaboutcookies.org.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">What types of cookies do we use?</h3>
              <p className="mb-2">There are a number of different types of cookies, however, our website uses:</p>
              <ul className="mb-4">
                <li>Functionality - We use these cookies so that we recognize you on our website and remember your previously selected preferences. These could include what language you prefer and location you are in. A mix of first-party and third-party cookies are used.</li>
              </ul>

              <h3 className="text-xl font-semibold mt-4 mb-2">How to manage cookies</h3>
              <p className="mb-4">You can set your browser not to accept cookies, and the above website tells you how to remove cookies from your browser. However, in a few cases, some of our website features may not function as a result.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">Privacy policies of other websites</h3>
              <p className="mb-4">Our website contains links to other websites. Our privacy policy applies only to our website, so if you click on a link to another website, you should read their privacy policy.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">Changes to our privacy policy</h3>
              <p className="mb-4">We keep our privacy policy under regular review and place any updates on this web page. This privacy policy was last updated on 22.03.2024.</p>

              <h3 className="text-xl font-semibold mt-4 mb-2">How to contact us</h3>
              <p className="mb-4">If you have any questions about our privacy policy, the data we hold on you, or you would like to exercise one of your data protection rights, please do not hesitate to contact us.</p>
              <p className="mb-2">Email us at: nadine.ziemert@uni-tuebingen.de</p>
              <p className="mb-2">Call us: +49 (0) 7071 2978841</p>
              <p className="mb-4">Or write to us at: Auf der Morgenstelle 24, 72076, Tübingen, Germany.</p>

              <p className="mt-4">Last updated: 22.03.2024</p>
        </div>
      </div>
    </MainLayout>
  )
}
