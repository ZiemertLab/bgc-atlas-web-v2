"use client";
import React from 'react';
import { Mail } from 'lucide-react';

// Split so the address never appears as a literal string in the source.
const USER_PARTS = ['caner', '.', 'bagci'];
const DOMAIN_PARTS = ['uni-tuebingen', '.', 'de'];

const USER = USER_PARTS.join('');
const DOMAIN = DOMAIN_PARTS.join('');

// Display form: "caner [dot] bagci [at] uni-tuebingen [dot] de"
const OBFUSCATED = `${USER.replace(/\./g, ' [dot] ')} [at] ${DOMAIN.replace(/\./g, ' [dot] ')}`;
const MAILTO = `mailto:${USER}@${DOMAIN}`;

export function EmailLink({
                              className = '',
                              children,
                              ariaLabel = 'Send email',
                              subject,
                              body,
                          }: {
    className?: string;
    children?: React.ReactNode;
    ariaLabel?: string;
    subject?: string;
    body?: string;
}) {
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    const query = params.toString();
    // URLSearchParams encodes spaces as "+", which mail clients paste literally.
    const href = query ? `${MAILTO}?${query.replace(/\+/g, '%20')}` : MAILTO;

    return (
        <a href={href} aria-label={ariaLabel} className={`inline-flex items-center gap-2 ${className}`}>
            {children ?? (<><Mail className="h-4 w-4" /><span>{OBFUSCATED}</span></>)}
        </a>
    );
}
