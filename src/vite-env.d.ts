/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_APP_SECRET: string;
  readonly VITE_PAYLOAD_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_LOCAL_API_PORT?: string;
  readonly VITE_AUTOMATION_ENABLED?: string;
  readonly VITE_VERCEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
