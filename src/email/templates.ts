// ── email/templates.ts ───────────────────────────────────────
//  Contenu de la séquence d'onboarding. Modifiez librement les
//  textes ici : chaque fonction renvoie { subject, html, text }.
// ─────────────────────────────────────────────────────────────

export interface TemplateContext {
  firstName:      string;
  appUrl:         string;   // ex. https://www.visionrplus.com
  bookingUrl?:    string;   // lien Calendly / Cal.com (optionnel)
  unsubscribeUrl: string;
}

export interface RenderedEmail { subject: string; html: string; text: string }

const NAVY   = '#1a2744';
const ORANGE = '#e07b2a';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function layout(ctx: TemplateContext, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${cta.url}" style="background:${ORANGE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6fa;font-family:Segoe UI,Arial,sans-serif;color:#334155">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${NAVY};padding:20px 28px;color:#fff;font-weight:800;font-size:20px">Vision R<span style="color:${ORANGE}">+</span></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${body}${button}
<p style="margin-top:28px">Arnaud<br><span style="color:#94a3b8">Fondateur de Vision R+</span></p></td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;font-size:12px;color:#94a3b8">
Vous recevez cet email car vous avez créé un compte sur Vision R+.
<a href="${ctx.unsubscribeUrl}" style="color:#94a3b8">Ne plus recevoir ces conseils</a></td></tr>
</table></td></tr></table></body></html>`;
}

const hello = (ctx: TemplateContext) => `Bonjour ${esc(ctx.firstName)},`;
const footerText = (ctx: TemplateContext) =>
  `\n\nArnaud — Fondateur de Vision R+\n\nNe plus recevoir ces conseils : ${ctx.unsubscribeUrl}`;

// J0 — Bienvenue (envoyé à l'inscription)
export function welcome(ctx: TemplateContext): RenderedEmail {
  const url = `${ctx.appUrl}/onboarding`;
  return {
    subject: 'Bienvenue sur Vision R+ 👋 — votre premier bilan en 5 minutes',
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Merci d'avoir rejoint Vision R+, la comptabilité <b>OHADA et PCG France</b> dans un seul outil.</p>
<p>Pour bien démarrer, l'assistant vous guide en 3 étapes :</p>
<ol><li>Créer votre entreprise (OHADA ou PCG)</li>
<li>Explorer l'entreprise de démonstration pour voir un vrai bilan</li>
<li>Importer votre journal Excel ou saisir votre première écriture</li></ol>
<p>Une question ? Répondez simplement à cet email, je lis tout personnellement.</p>`,
      { label: 'Lancer l\'assistant', url }),
    text: `${hello(ctx)}\n\nMerci d'avoir rejoint Vision R+. Lancez l'assistant de démarrage : ${url}\n\nUne question ? Répondez à cet email.${footerText(ctx)}`,
  };
}

// J+1 — Activation : pas encore d'écriture dans une vraie entreprise
export function activation(ctx: TemplateContext, plan = 'free'): RenderedEmail {
  // La limite du plan Gratuit n'est rappelée qu'aux comptes gratuits
  const freeNote = plan === 'free'
    ? '<p style="color:#64748b;font-size:13px">Plan Gratuit : 10 écritures par mois. Pour importer un journal complet, essayez le plan Pro 14 jours gratuitement.</p>'
    : '';
  const url = `${ctx.appUrl}/journal`;
  return {
    subject: 'Importez votre journal Excel en 2 minutes',
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Vous tenez déjà votre comptabilité sur Excel ? Pas besoin de tout ressaisir.</p>
<p>Dans Excel, faites <b>Fichier → Enregistrer sous → CSV</b>, puis dans Vision R+ <b>Journal → Importer</b> :
Vision R+ génère automatiquement le Grand Livre, la Balance, le Compte de résultat et le Bilan.</p>
${freeNote}
<p>Pas de fichier sous la main ? Ouvrez l'<b>entreprise de démonstration</b> pour voir le résultat final.</p>`,
      { label: 'Importer mon journal', url }),
    text: `${hello(ctx)}\n\nImportez votre journal Excel en 2 minutes : ${url}\nVision R+ génère ensuite Grand Livre, Balance, Compte de résultat et Bilan.${footerText(ctx)}`,
  };
}

// J+3 — Aide personnelle : toujours rien de saisi
export function help(ctx: TemplateContext): RenderedEmail {
  const cta = ctx.bookingUrl
    ? { label: 'Réserver 10 minutes avec moi', url: ctx.bookingUrl }
    : { label: 'Ouvrir le guide pas à pas', url: `${ctx.appUrl}/guide` };
  return {
    subject: 'Je vous montre Vision R+ en 10 minutes ?',
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Je vois que vous n'avez pas encore enregistré d'écriture. C'est souvent qu'il manque juste un petit coup de pouce.</p>
<p>Je vous propose <b>10 minutes en visio</b> : je vous montre comment obtenir votre bilan à partir de vos propres données.
Vous décidez ensuite si l'outil vous convient.</p>
<p>${ctx.bookingUrl ? 'Choisissez simplement un créneau :' : 'Répondez à cet email avec vos disponibilités, ou consultez le guide :'}</p>`,
      cta),
    text: `${hello(ctx)}\n\nJe vous propose 10 minutes en visio pour vous montrer Vision R+ avec vos données. ${cta.label} : ${cta.url}\nOu répondez simplement à cet email.${footerText(ctx)}`,
  };
}

// J-3 avant la fin de l'essai
export function trialEnding(ctx: TemplateContext, endsAt: Date): RenderedEmail {
  const date = endsAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const url  = `${ctx.appUrl}/abonnement`;
  return {
    subject: `Votre essai Vision R+ se termine le ${date}`,
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Votre période d'essai se termine le <b>${date}</b>. Votre abonnement démarrera alors automatiquement,
et vous gardez toutes vos données et vos états financiers.</p>
<p>Vous pouvez à tout moment changer de formule ou gérer votre moyen de paiement depuis vos paramètres.</p>
<p>Si quelque chose vous freine, répondez à cet email : je veux savoir ce qu'on peut améliorer.</p>`,
      { label: 'Gérer mon abonnement', url }),
    text: `${hello(ctx)}\n\nVotre essai se termine le ${date}. Gérez votre abonnement : ${url}${footerText(ctx)}`,
  };
}

// Mobile Money — 3 jours avant la fin des 30 jours (pas de renouvellement automatique)
export function mobileMoneyEnding(ctx: TemplateContext, plan: string, endsAt: Date): RenderedEmail {
  const date = endsAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const url  = `${ctx.appUrl}/abonnement`;
  return {
    subject: `Votre accès ${plan} se termine le ${date}`,
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Votre accès <b>${esc(plan)}</b> payé par Mobile Money se termine le <b>${date}</b>.
Le paiement Mobile Money ne se renouvelle pas automatiquement.</p>
<p>Pour continuer sans interruption, renouvelez en quelques secondes depuis votre espace Abonnement.
Sans renouvellement, votre compte repassera à la formule Gratuit : vos données sont conservées.</p>`,
      { label: 'Renouveler mon accès', url }),
    text: `${hello(ctx)}\n\nVotre accès ${plan} (Mobile Money) se termine le ${date}. Renouvelez ici : ${url}\nSans renouvellement, votre compte repasse au Gratuit (données conservées).${footerText(ctx)}`,
  };
}

// Après souscription — merci + recommandation
export function subscribed(ctx: TemplateContext, plan: string): RenderedEmail {
  const url = `${ctx.appUrl}/dashboard`;
  return {
    subject: 'Merci pour votre confiance 🙏',
    html: layout(ctx, `
<p>${hello(ctx)}</p>
<p>Votre abonnement <b>${esc(plan)}</b> est activé. Merci de faire confiance à Vision R+ !</p>
<p>Une faveur : si vous connaissez un dirigeant, un comptable ou un cabinet qui pourrait en profiter,
transférez-lui cet email. Les recommandations sont ce qui nous aide le plus à grandir.</p>`,
      { label: 'Ouvrir mon tableau de bord', url }),
    text: `${hello(ctx)}\n\nVotre abonnement ${plan} est activé, merci ! Si vous connaissez quelqu'un qui pourrait en profiter, transférez-lui cet email.\n${url}${footerText(ctx)}`,
  };
}
