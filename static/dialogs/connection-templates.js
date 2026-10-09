export const templates = {
  custom: {
    label: "Custom function",
    namespace: "custom",
    settings: {},
    code: `context.log('Processing', user.email || user.id);
// user includes email, name, traits, identities, event_count, and last_seen.
// Use context.fetch, context.settings, context.log, and context.runId.
// Return { traits: { ... } } to enrich this profile.
return { processed: true };`,
  },
  beehiiv: {
    label: "Push to Beehiiv",
    namespace: "beehiiv",
    settings: { API_KEY: "", PUBLICATION_ID: "" },
    code: `if (!user.email) throw new Error('This user has no email');
const { API_KEY, PUBLICATION_ID } = context.settings;
if (!API_KEY || !PUBLICATION_ID) throw new Error('Set API_KEY and PUBLICATION_ID');
const response = await context.fetch(
  'https://api.beehiiv.com/v2/publications/' + encodeURIComponent(PUBLICATION_ID) + '/subscriptions',
  { method: 'POST', headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, reactivate_existing: false, send_welcome_email: false }) }
);
if (!response.ok) throw new Error('Beehiiv returned HTTP ' + response.status);
const result = await response.json();
return { subscriptionId: result.data?.id };`,
  },
  pdl: {
    label: "Enrich with People Data Labs",
    namespace: "pdl",
    settings: { API_KEY: "" },
    code: `if (!user.email) throw new Error('This user has no email');
if (!context.settings.API_KEY) throw new Error('Set API_KEY');
const url = new URL('https://api.peopledatalabs.com/v5/person/enrich');
url.searchParams.set('email', user.email);
const response = await context.fetch(url, { headers: { 'X-Api-Key': context.settings.API_KEY } });
if (!response.ok) throw new Error('People Data Labs returned HTTP ' + response.status);
const { data } = await response.json();
return { traits: {
  full_name: data.full_name ?? null,
  job_title: data.job_title ?? null,
  company: data.job_company_name ?? null,
  linkedin_url: data.linkedin_url ?? null
} };`,
  },
};
