"use client";

import { apiFetch } from "@/lib/basePath";
import { useState, useRef } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { TemplateDownload } from '@/components/contribute/template-download';
import { MetadataUpload } from '@/components/contribute/metadata-upload';
import { MetadataForm } from '@/components/contribute/metadata-form';
import type { BatchValidationResult, SampleMetadata } from '@/lib/metadata/types';
import { EmailLink } from '@/components/layout/email-link';
import { CONTRIBUTE_ASSEMBLY_MAX_BYTES, CONTRIBUTE_ASSEMBLY_MAX_LABEL } from '@/lib/contribute/limits';

export default function ContributePage() {
  const [name, setName] = useState('');
  const [institute, setInstitute] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [assembly, setAssembly] = useState<File | null>(null);
  // Over the upload limit (checked here) or refused by the server as too large.
  const [assemblyTooLarge, setAssemblyTooLarge] = useState(false);
  const [metadataFile, setMetadataFile] = useState<File | null>(null);
  const [metadataInputMethod, setMetadataInputMethod] = useState<'csv' | 'form'>('form');
  const [formSamples, setFormSamples] = useState<SampleMetadata[]>([]);
  const [, setValidationResult] = useState<BatchValidationResult | null>(null);
  const assembliesInputRef = useRef<HTMLInputElement | null>(null);
  const metadataInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  const isStep1Valid = name.trim() !== '' && institute.trim() !== '' && email.trim() !== '';
  const isStep2Valid = description.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (step < 3) {
      if (step === 1 && isStep1Valid) setStep(2);
      else if (step === 2 && isStep2Valid) setStep(3);
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);
    try {
      if (!assembly && !metadataFile && formSamples.length === 0) {
        const ok = confirm('You have not selected any FASTA or metadata files. Do you want to submit without uploading files?')
        if (!ok) {
          setSubmitting(false)
          return
        }
      }

      const form = new FormData();
      form.append('name', name);
      form.append('institute', institute);
      form.append('email', email);
      form.append('description', description);

      if (assembly) {
        form.append('assemblies', assembly);
      }

      if (metadataInputMethod === 'csv' && metadataFile) {
        form.append('metadata', metadataFile);
      } else if (metadataInputMethod === 'form' && formSamples.length > 0) {
        // TSV long format
        const tsvLines = ['sample_alias\tmetadata_key\tvalue'];

        for (const sample of formSamples) {
          for (const [key, value] of Object.entries(sample)) {
            if (value !== undefined && value !== null && value !== '' && key !== 'additional_metadata' && key !== 'assembly_filenames') {
              tsvLines.push(`${sample.sample_alias}\t${key}\t${value}`);
            }
          }
        }

        const tsvContent = tsvLines.join('\n');
        const tsvBlob = new Blob([tsvContent], { type: 'text/tab-separated-values' });
        const tsvFile = new File([tsvBlob], 'metadata.tsv', { type: 'text/tab-separated-values' });
        form.append('metadata', tsvFile);
      }

      const res = await apiFetch('/api/contribute', {
        method: 'POST',
        body: form,
      });

      const payload = await res.json().catch(() => null)
      if (res.ok) {
        const sampleCount = payload?.sampleCount || 0;
        const message = sampleCount > 0
          ? `Submission received! ${sampleCount} sample(s) processed. Thank you!`
          : 'Submission received. Thank you!';
        setStatusMessage(message);
        setName('');
        setInstitute('');
        setEmail('');
        setDescription('');
        setAssembly(null);
        setAssemblyTooLarge(false);
        setMetadataFile(null);
        setFormSamples([]);
        setMetadataInputMethod('form');
        setValidationResult(null);
        setStep(1);
        if (assembliesInputRef.current) assembliesInputRef.current.value = '';
        if (metadataInputRef.current) metadataInputRef.current.value = '';
      } else if (res.status === 413) {
        // nginx answers an over-limit body with its own HTML page, so there is no
        // JSON error to show.
        setAssemblyTooLarge(true);
        setStatusMessage(`The upload is larger than the ${CONTRIBUTE_ASSEMBLY_MAX_LABEL} limit.`);
      } else {
        const msg = payload?.error || 'Submission failed. Please try again later.'
        setStatusMessage(msg)
      }
    } catch {
      setStatusMessage('An error occurred. Please try again later.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-1.5">Contribute</div>
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Submit a dataset
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Upload a metagenome assembly and its metadata to contribute to BGC
            Atlas.
          </p>
        </header>

        <div className="border border-border bg-card px-6 py-5">
          <ol className="mb-6 grid grid-cols-3 gap-4 text-xs">
            {[
              { s: 1, label: 'Contact info' },
              { s: 2, label: 'Metadata' },
              { s: 3, label: 'Assembly file' }
            ].map((item) => {
              const done = step > item.s;
              const active = step === item.s;
              return (
                <li key={item.s} className="flex items-center gap-2">
                  <span
                    className={`flex size-5 items-center justify-center rounded-sm border font-mono text-[11px] ${
                      done
                        ? 'border-foreground bg-foreground text-background'
                        : active
                        ? 'border-foreground text-foreground'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {done ? <CheckCircle2 className="size-3" /> : item.s}
                  </span>
                  <span className={`uppercase tracking-wider ${active || done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {item.label}
                  </span>
                </li>
              );
            })}
          </ol>

            <form onSubmit={handleSubmit} className="space-y-6">
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium">Contact Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>

                  <div>
                    <label className="block text-sm font-medium">Institute / Affiliation</label>
                    <Input value={institute} onChange={(e) => setInstitute(e.target.value)} required />
                  </div>

                  <div>
                    <label className="block text-sm font-medium">Email</label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Dataset Description</label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      required
                      placeholder="Provide a brief description of your dataset, including the sampling strategy, environment, and any relevant details..."
                    />
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Sample Metadata</label>
                      <p className="text-xs text-muted-foreground mb-3">
                        Provide standardized metadata for your samples. Choose your preferred input method:
                      </p>
                    </div>

                    <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                      <Button
                        type="button"
                        size="sm"
                        variant={metadataInputMethod === 'form' ? 'default' : 'ghost'}
                        onClick={() => {
                          setMetadataInputMethod('form');
                          setMetadataFile(null);
                          setValidationResult(null);
                        }}
                      >
                        Fill in Browser
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={metadataInputMethod === 'csv' ? 'default' : 'ghost'}
                        onClick={() => {
                          setMetadataInputMethod('csv');
                          setFormSamples([]);
                          setValidationResult(null);
                        }}
                      >
                        Upload TSV
                      </Button>
                    </div>

                    {metadataInputMethod === 'csv' && (
                      <div className="space-y-4">
                        <TemplateDownload />
                        <div className="border-t pt-4">
                          <MetadataUpload
                            onFileSelect={setMetadataFile}
                            onValidationComplete={setValidationResult}
                          />
                        </div>
                      </div>
                    )}

                    {metadataInputMethod === 'form' && (
                      <div className="border rounded-lg p-4 bg-muted/30">
                        <MetadataForm
                          onSamplesChange={setFormSamples}
                          onValidationChange={setValidationResult}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="assemblies-input" className="block text-sm font-medium">Assembly (FASTA)</label>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        id="assemblies-input"
                        ref={assembliesInputRef}
                        className="hidden"
                        type="file"
                        accept=".fa,.fna,.fasta,.gz"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file && file.size > CONTRIBUTE_ASSEMBLY_MAX_BYTES) {
                            // Refuse before uploading: the server would only reject
                            // it after the whole file had been sent.
                            setAssembly(null);
                            setAssemblyTooLarge(true);
                            e.target.value = '';
                            return;
                          }
                          setAssembly(file);
                          setAssemblyTooLarge(false);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => { e.preventDefault(); assembliesInputRef.current?.click(); }}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Upload FASTA File
                      </Button>
                      <span className="text-sm text-muted-foreground">{assembly ? assembly.name : ''}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      One assembly file (FASTA, optionally gzipped), up to {CONTRIBUTE_ASSEMBLY_MAX_LABEL}.
                    </p>
                    <p className={`mt-1 text-xs ${assemblyTooLarge ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {assemblyTooLarge
                        ? `That file is larger than ${CONTRIBUTE_ASSEMBLY_MAX_LABEL}. `
                        : 'For a larger file, or several assemblies, '}
                      {assemblyTooLarge ? 'Please contact us by email instead: ' : 'contact us by email: '}
                      <EmailLink
                        className="underline underline-offset-2"
                        subject="BGC Atlas contribution: large assembly upload"
                      />
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-4">
                <div className="flex items-center gap-2">
                  {step > 1 && (
                    <Button key="prev-btn" type="button" variant="outline" onClick={(e) => { e.preventDefault(); setStep(step - 1); }}>Previous</Button>
                  )}
                  {step < 3 ? (
                    <Button
                      key="next-btn"
                      type="button"
                      onClick={(e) => { e.preventDefault(); setStep(step + 1); }}
                      disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button key="submit-btn" type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</Button>
                  )}
                </div>
                <Button key="reset-btn" type="button" variant="ghost" onClick={(e) => { e.preventDefault(); setName(''); setInstitute(''); setEmail(''); setDescription(''); setAssembly(null); setAssemblyTooLarge(false); setMetadataFile(null); setFormSamples([]); setMetadataInputMethod('form'); setValidationResult(null); setStep(1); if (assembliesInputRef.current) assembliesInputRef.current.value = ''; if (metadataInputRef.current) metadataInputRef.current.value = ''; }}>Reset</Button>
              </div>

              {statusMessage && <div className="text-sm text-muted-foreground">{statusMessage}</div>}
            </form>
        </div>
      </div>
    </MainLayout>
  );
}
