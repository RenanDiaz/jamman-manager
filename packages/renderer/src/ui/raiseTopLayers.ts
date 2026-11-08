const TOP_LAYER_ATTR = 'data-jm-top-layer';

/**
 * A modal <dialog> sits in the browser's top layer, above everything else on the page,
 * including toasts. Elements rendered by `TopLayer` are manual popovers, also in the top
 * layer; showing them again after a dialog opens puts them back on top of it.
 */
export function raiseTopLayers() {
  document.querySelectorAll<HTMLElement>(`[${TOP_LAYER_ATTR}]`).forEach(el => {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  });
}

export const topLayerProps = { [TOP_LAYER_ATTR]: '' } as const;
