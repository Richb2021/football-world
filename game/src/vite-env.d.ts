/// <reference types="vite/client" />
declare module 'virtual:pwa-register' {
  export function registerSW(opts?: { immediate?: boolean }): (reload?: boolean) => Promise<void>;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  /** Supabase project URL (public). Absent → online features stay offline. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key (public, client-safe). NEVER the service-role key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Grayson Games API base URL, e.g. https://api.graysongames.com. */
  readonly VITE_API_BASE_URL?: string;
  /** Public PayPal client id for browser checkout buttons. */
  readonly VITE_PAYPAL_CLIENT_ID?: string;
}

interface Window {
  paypal?: {
    Buttons: (opts: {
      createOrder: () => Promise<string>;
      onApprove: (data: { orderID: string }) => Promise<void>;
      onError?: (err: unknown) => void;
      onCancel?: () => void;
    }) => { render: (selector: string | HTMLElement) => Promise<void> };
  };
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
