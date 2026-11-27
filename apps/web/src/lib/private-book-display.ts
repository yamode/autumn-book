import { getContext, setContext } from 'svelte';

const rateDisplay = Symbol('private book rate display');

export function setPrivateBookDisplay(preview: () => object | null) {
  setContext(rateDisplay, preview);
}

export function getPrivateBookDisplay<T extends object>() {
  const preview = getContext<(() => Partial<T> | null) | undefined>(rateDisplay);
  return (data: T): T => {
    const rates = preview?.();
    return rates ? { ...data, ...rates } : data;
  };
}
