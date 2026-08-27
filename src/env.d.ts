/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_CARTO_API_KEY?: string;
  readonly PUBLIC_LAB_MODE?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_BASE_PATH?: string;
  readonly PUBLIC_FIREBASE_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

interface Window {
  currentTime?: string | null;
  currentDayType?: string;
  currentDayIndex?: number;
  openLegal?: (type: string) => void;
  showToast?: (message: string, type?: string, duration?: number, actionHTML?: string) => void;
  findNextTrains?: () => void;
  updateFareDisplay?: (sheetKey?: string | null, timeOverride?: string | null) => void;
  _suppressReloads?: boolean;
  MASTER_STATION_LIST?: string[];
  GHOST_STATION_LIST?: string[];
  switchTab?: (tab: string) => void;
  syncBottomNavActive?: (tab?: string) => void;
  setImmersiveChrome?: (on: boolean) => void;
  openAppHub?: () => void;
  closeAppHub?: () => void;
  openAccountModal?: () => void;
  signOutAccount?: () => Promise<void>;
  openSmoothModal?: (modalId: string, customOrigin?: unknown) => void;
  closeSmoothModal?: (modalId: string) => void;
  toggleDropdownScrim?: (listId?: string | null, chevronId?: string | null) => void;
  triggerHaptic?: () => void;
  swapPlannerResults?: () => void;
  restorePlannerSearch?: (fullFrom: string, fullTo: string) => void;
  openDisruptionModal?: (id: string) => void;
  hidePlannerResults?: () => void;
  selectPlannerTrip?: (index: number | string) => void;
  togglePlannerStops?: (id: string) => void;
  _toggleCustomTimeDropdown?: (e?: Event) => void;
  _selectCustomTrip?: (idx: number) => void;
  _toggleMainDayDropdown?: (e?: Event) => void;
  _selectMainDay?: (e: Event | null, value: string, text: string) => void;
  _toggleHeaderDayDropdown?: (e?: Event) => void;
  _selectHeaderDay?: (e: Event | null, value: string, text: string) => void;
  __NT_CARTO_KEY?: string;
  ntCartoVoyagerUrl?: () => string;
  openTripMapRenderer?: (routeData: unknown) => Promise<void>;
  _plannerCurrentTripIndex?: number;
  openLightbox?: (url: string) => void;
  closeLightbox?: (fromPopState?: boolean) => void;
}
