import type { Metadata } from 'next'
import { MainLayout } from '@/components/layout/main-layout'

export const metadata: Metadata = {
  title: 'Imprint',
  description: 'Imprint and legal information for BGC Atlas, hosted at the University of Tübingen.',
  alternates: { canonical: '/imprint' },
}

export default function ImprintPage() {
  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Impressum
          </h1>
        </header>
        <div className="prose prose-sm lg:prose-base max-w-none text-foreground">
              <h3 className="text-xl font-semibold mt-2 mb-2">General information according to § 5 TMG, § 55 RStVG</h3>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Address:</td>
                      <td className="border px-3 py-2">University of Tübingen<br/>Geschwister-Scholl-Platz<br/>72074 Tübingen</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2"></td>
                      <td className="border px-3 py-2">The University of Tübingen is a corporation under public law. Its legal representative is the President and Vice-Chancellor, Professor Dr. Dr. h.c. (Dōshisha) Karla Pollmann (E-Mail: rektorin@uni-tuebingen.de).</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Central phone no:</td>
                      <td className="border px-3 py-2">+49 (0) 70 71/29-0</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Central Administraion fax no:</td>
                      <td className="border px-3 py-2">+49 (0) 70 71/29-59 90</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Central e-mail address:</td>
                      <td className="border px-3 py-2">info@uni-tuebingen.de</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Internet address:</td>
                      <td className="border px-3 py-2">https://uni-tuebingen.de</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Value added tax ID no.:</td>
                      <td className="border px-3 py-2">according to § 27 a Umsatzsteuergesetz: <br/><strong>DE812383453</strong></td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Supervisory authority</td>
                      <td className="border px-3 py-2">Baden-Württemberg Ministry of Science, Research and the Arts<br/>Königstraße 46 a<br/>70173 Stuttgart<br/>Website: https://mwk.baden-wuerttemberg.de/de/startseite/</td>
                    </tr>
                    <tr>
                      <td className="align-top border px-3 py-2 font-medium">Last Updated:</td>
                      <td className="border px-3 py-2">22.03.2024</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-xl font-semibold mt-6 mb-2">External Links</h3>
              <p className="mb-4">This University of Tübingen website also contains appropriately marked links and references to third-party websites. Via any such link, the University of Tübingen merely provides access to the content. This does not imply any approval of the contents of the linked third-party sites. The University of Tübingen therefore accepts no responsibility for the availability or content of such websites and no liability for damage or injury resulting from the use – in whatever form – of such content. The provider of the respective site is solely liable for this.</p>
              <p className="mb-4">When linking to another website for the first time, the editorial team checked the content of that website to see whether it might give rise to any civil or criminal liability. However, it is unfortunately not possible to check content subsequently included there. The link will be removed immediately as soon as the editors notice or are informed by others that a certain site, to which a link has been provided, gives rise to civil or criminal liability.</p>

              <h3 className="text-xl font-semibold mt-6 mb-2">Copyright</h3>
              <p className="mb-4">Copyright (c). All rights reserved.</p>
              <p className="mb-4">All content published on this website (layout, text, images, graphics, video and sound files, etc.) is subject to copyright. Any use not permitted by copyright law requires the prior express consent of the Translational Genome Mining for Natural Products research group. This applies in particular to the copying, editing, translation, storage, processing and reproduction of content in databases or other electronic media or systems. Photocopies and downloads of web pages for private, academic and non-commercial use are permitted.</p>
              <p className="mb-4">The copyright for the University of Tübingen logo is expressly held by the University of Tübingen.</p>
              <p className="mb-4">We expressly permit and welcome the citation of our documents and web pages as well as the setting of links to our website.</p>

              <h3 className="text-xl font-semibold mt-6 mb-2">Disclaimer</h3>
              <p className="mb-4">The information on this website has been carefully compiled and checked to the best of our knowledge and belief. However, no guarantee – neither explicit nor implicit – is given for the completeness, correctness or topicality nor of the availability of the information provided at any time. Liability for damages resulting from the use or non-use of the information provided on this website is – as far as legally permissible – excluded.</p>

              <h5 className="mt-6">Responsible</h5>
              <p className="mb-0">Prof. Dr. Nadine Ziemert<br/>Auf der Morgenstelle 24<br/>72076 Tübingen<br/>Phone: +49 7071 29788441<br/>E-Mail: nadine.ziemert@uni-tuebingen.de</p>
        </div>
      </div>
    </MainLayout>
  )
}
