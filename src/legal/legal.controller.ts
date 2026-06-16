import { Controller, Get, Header } from '@nestjs/common';

@Controller('legal')
export class LegalController {

  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacyPolicy(): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Politique de Confidentialité — Vision R+</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { color: #1a73e8; } h2 { color: #333; margin-top: 30px; }
    .logo { font-size: 24px; font-weight: bold; color: #1a73e8; margin-bottom: 10px; }
    .date { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="logo">Vision R+</div>
  <h1>Politique de Confidentialité</h1>
  <p class="date">Dernière mise à jour : mai 2026</p>

  <h2>1. Présentation</h2>
  <p>Vision R+ (« nous ») est un logiciel de comptabilité SaaS destiné aux PME françaises (PCG France) et africaines (OHADA). Cette politique décrit comment nous collectons, utilisons et protégeons vos données personnelles.</p>

  <h2>2. Données collectées</h2>
  <p>Nous pouvons collecter les informations suivantes :</p>
  <ul>
    <li>Informations de compte : nom, adresse e-mail, nom de l'entreprise</li>
    <li>Données comptables saisies dans le logiciel</li>
    <li>Messages envoyés à notre page Facebook (pour le service client automatisé)</li>
    <li>Données d'utilisation et logs techniques</li>
  </ul>

  <h2>3. Utilisation des données</h2>
  <p>Vos données sont utilisées pour :</p>
  <ul>
    <li>Fournir et améliorer le service Vision R+</li>
    <li>Répondre à vos messages via notre assistant automatique (Facebook Messenger)</li>
    <li>Assurer la sécurité et le bon fonctionnement de la plateforme</li>
    <li>Vous contacter en cas de besoin</li>
  </ul>

  <h2>4. Partage des données</h2>
  <p>Nous ne vendons pas vos données personnelles. Vos données peuvent être partagées avec :</p>
  <ul>
    <li>Meta Platforms (Facebook/Messenger) pour le service de messagerie</li>
    <li>Anthropic (traitement IA des messages)</li>
    <li>Railway (hébergement cloud)</li>
  </ul>

  <h2>5. Sécurité</h2>
  <p>Nous mettons en œuvre des mesures de sécurité appropriées pour protéger vos données contre tout accès non autorisé, modification, divulgation ou destruction.</p>

  <h2>6. Vos droits</h2>
  <p>Conformément au RGPD, vous disposez des droits d'accès, de rectification, d'effacement et de portabilité de vos données. Pour exercer ces droits, contactez-nous à : <strong>fredericmatsiendi@gmail.com</strong></p>

  <h2>7. Cookies</h2>
  <p>Notre application utilise des cookies techniques nécessaires au fonctionnement du service.</p>

  <h2>8. Contact</h2>
  <p>Pour toute question relative à cette politique :<br>
  <strong>Vision R+</strong><br>
  Email : fredericmatsiendi@gmail.com<br>
  Site : <a href="https://www.visionrplus.com">www.visionrplus.com</a></p>
</body>
</html>`;
  }
}
