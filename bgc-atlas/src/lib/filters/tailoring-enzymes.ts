// Tailoring enzyme classes -> representative Pfam ids; `tailoring_class` expands to
// these on the `pfam` facet.
export const TAILORING_CLASSES: { label: string; pfam: string[] }[] = [
  { label: 'Cytochrome P450', pfam: ['PF00067'] },
  { label: 'Methyltransferase', pfam: ['PF00891', 'PF08241', 'PF08242', 'PF13649', 'PF13489'] },
  { label: 'Glycosyltransferase', pfam: ['PF00201', 'PF00534', 'PF13692', 'PF04101'] },
  { label: 'Halogenase', pfam: ['PF04820'] },
  { label: 'Flavin-dependent monooxygenase', pfam: ['PF00743', 'PF00890', 'PF01494'] },
  { label: 'Acyltransferase', pfam: ['PF00583'] },
  { label: 'Aminotransferase', pfam: ['PF00202', 'PF00155'] },
  { label: 'Rieske oxygenase', pfam: ['PF00355'] },
  { label: 'Sulfotransferase', pfam: ['PF00685'] },
  { label: 'Prenyltransferase', pfam: ['PF11991'] },
];

export const TAILORING_OPTIONS = TAILORING_CLASSES.map((c) => ({ label: c.label, value: c.label }));

export const TAILORING_EXPANSION: Record<string, string[]> = Object.fromEntries(
  TAILORING_CLASSES.map((c) => [c.label, c.pfam]),
);
