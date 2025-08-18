import admin from 'firebase-admin';
import dotenv from 'dotenv';

export interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}
dotenv.config();
// Initialize Firebase Admin SDK
const serviceAccount: FirebaseServiceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID!,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID!,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
  client_email: process.env.FIREBASE_CLIENT_EMAIL!,
  client_id: process.env.FIREBASE_CLIENT_ID!,
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL!
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const auth = admin.auth();
const firestore = admin.firestore();

export { admin, auth, firestore };
