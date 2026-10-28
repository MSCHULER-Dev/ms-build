const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const multer = require('multer'); // Pour gérer l'upload de fichiers
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dossier temporaire pour stocker les fichiers avant de les envoyer par mail
const upload = multer({ dest: 'uploads/' });

app.use(express.static(path.join(__dirname, 'MS-Build codage')));
app.use(express.static(__dirname));

const dbPool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'mschuler_dev'
});

const storeTokens = {};

// Route de traitement du brief et des fichiers
app.post('/api/generate-site', upload.array('clientFiles'), async (req, res) => {
    try {
        const { companyName, activitySector, activityLocation, servicesDescription, plan, clientPhone, clientEmail } = req.body;
        const uploadedFiles = req.files || [];

        const storeId = companyName ? companyName.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'ma-boutique';
        if (!storeTokens[storeId]) {
            storeTokens[storeId] = crypto.randomBytes(16).toString('hex');
        }
        const secretToken = storeTokens[storeId];

        // 1. Sauvegarde en BDD MySQL
        try {
            await dbPool.execute(
                `INSERT INTO prospects (company_name, activity_sector, activity_location, services_description, plan, client_phone, client_email, store_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [companyName, activitySector, activityLocation, servicesDescription, plan || 'Essentiel', clientPhone || '', clientEmail || '', storeId]
            );
            console.log("✅ Prospect enregistré avec succès dans MySQL !");
        } catch (dbError) {
            console.error("❌ Erreur d'enregistrement BDD :", dbError);
        }

        // 2. Préparation des pièces jointes et envoi via l'API HTTP de Brevo
        try {
            const apiKey = process.env.BREVO_API_KEY;
            if (!apiKey) {
                console.error("❌ Clé API Brevo manquante dans les variables d'environnement !");
            } else {
                // Filtrage et encodage des fichiers compatibles (évite les erreurs de format comme webp)
                const attachments = [];
                for (const file of uploadedFiles) {
                    const ext = path.extname(file.originalname).toLowerCase();
                    // On autorise les formats d'images classiques et les PDF
                    if(['.jpg', '.jpeg', '.png', '.pdf', '.txt'].includes(ext)) {
                        const fileContent = fs.readFileSync(file.path);
                        attachments.push({
                            content: fileContent.toString('base64'),
                            name: file.originalname
                        });
                    } else {
                        console.log(`⚠️ Fichier ignoré pour l'e-mail (format non pris en charge par l'API) : ${file.originalname}`);
                    }
                }

                const emailTextContent = 
`==================================================
  NOUVELLE COMMANDE / BRIEF SUR-MESURE
==================================================

📌 ENTREPRISE & ACTIVITÉ
--------------------------------------------------
• Nom de l'entreprise : ${companyName}
• Secteur d'activité  : ${activitySector}
• Localisation        : ${activityLocation}
• Formule choisie     : ${(plan || 'Essentiel').toUpperCase()}

💼 PRESTATIONS & BESOINS DU CLIENT
--------------------------------------------------
${servicesDescription}

📞 COORDONNÉES DU CLIENT
--------------------------------------------------
• Téléphone : ${clientPhone || 'Non renseigné'}
• E-mail    : ${clientEmail || 'Non renseigné'}

📎 FICHIERS REÇUS (${uploadedFiles.length} fichier(s))
--------------------------------------------------
${uploadedFiles.length > 0 ? uploadedFiles.map(f => `- ${f.originalname}`).join('\n') : 'Aucun fichier joint'}

==================================================
À toi de jouer pour coder le site et lui envoyer les premiers screens !`;

                const emailPayload = {
                    sender: { name: "MS-Build Bot", email: process.env.EMAIL_USER },
                    to: [{ email: process.env.EMAIL_USER, name: "Maxime" }],
                    subject: `🚀 Nouvelle commande : ${companyName} [Formule ${(plan || 'Essentiel').toUpperCase()}]`,
                    textContent: emailTextContent
                };

                // Ajout des pièces jointes uniquement s'il y en a de valides
                if (attachments.length > 0) {
                    emailPayload.attachment = attachments;
                }

                const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'api-key': apiKey,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify(emailPayload)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    console.error("❌ Erreur API Brevo :", errorData);
                } else {
                    console.log("✅ E-mail et pièces jointes envoyés avec succès via l'API Brevo !");
                }
            }
        } catch (mailError) {
            console.error("❌ Erreur d'envoi d'e-mail :", mailError);
        }

        // Nettoyage des fichiers temporaires du dossier uploads/
        uploadedFiles.forEach(file => {
            fs.unlink(file.path, (err) => {
                if (err) console.error("Erreur suppression fichier temp :", err);
            });
        });

        res.status(200).json({
            success: true,
            storeId,
            secretToken
        });
    } catch (error) {
        console.error("Erreur critique traitement brief :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur en route sur le port ${PORT}`);
});