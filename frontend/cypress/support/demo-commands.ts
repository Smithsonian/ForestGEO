function isDemoModeEnabled() {
  return Cypress.env('demoMode') === true || Cypress.env('demoMode') === 'true';
}

function getDemoDelayMs(override?: number) {
  const envValue = Number(Cypress.env('demoDelayMs'));
  if (typeof override === 'number' && Number.isFinite(override)) {
    return override;
  }
  if (Number.isFinite(envValue) && envValue >= 0) {
    return envValue;
  }
  return 1200;
}

function ensureDemoOverlay(doc: Document) {
  let overlay = doc.getElementById('cy-demo-overlay');

  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = 'cy-demo-overlay';
    overlay.innerHTML = `
      <div id="cy-demo-overlay-title">ForestGEO Cypress Demo</div>
      <div id="cy-demo-overlay-message">Preparing demo...</div>
    `;
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      maxWidth: '420px',
      padding: '14px 16px',
      borderRadius: '14px',
      background: 'rgba(15, 23, 42, 0.92)',
      color: '#f8fafc',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      boxShadow: '0 16px 40px rgba(15, 23, 42, 0.35)',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      pointerEvents: 'none',
      transition: 'opacity 180ms ease, transform 180ms ease',
      opacity: '0',
      transform: 'translateY(-6px)'
    });

    const title = overlay.querySelector('#cy-demo-overlay-title') as HTMLElement;
    const message = overlay.querySelector('#cy-demo-overlay-message') as HTMLElement;

    Object.assign(title.style, {
      fontSize: '12px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#93c5fd',
      marginBottom: '6px',
      fontWeight: '700'
    });

    Object.assign(message.style, {
      fontSize: '18px',
      lineHeight: '1.4',
      fontWeight: '600'
    });

    doc.body.appendChild(overlay);
  }

  return overlay;
}

function clearDemoHighlights(doc: Document) {
  doc.querySelectorAll('[data-cy-demo-highlight="true"]').forEach(element => {
    element.removeAttribute('data-cy-demo-highlight');
    const htmlElement = element as HTMLElement;
    htmlElement.style.removeProperty('outline');
    htmlElement.style.removeProperty('outline-offset');
    htmlElement.style.removeProperty('box-shadow');
    htmlElement.style.removeProperty('transition');
    htmlElement.style.removeProperty('border-radius');
  });
}

function applyDemoHighlight(doc: Document, selector?: string) {
  clearDemoHighlights(doc);

  if (!selector) return;

  doc.querySelectorAll(selector).forEach(element => {
    const htmlElement = element as HTMLElement;
    htmlElement.setAttribute('data-cy-demo-highlight', 'true');
    htmlElement.style.outline = '3px solid #f97316';
    htmlElement.style.outlineOffset = '4px';
    htmlElement.style.boxShadow = '0 0 0 6px rgba(249, 115, 22, 0.22)';
    htmlElement.style.transition = 'outline-color 120ms ease, box-shadow 120ms ease';
    htmlElement.style.borderRadius = '10px';
  });
}

declare global {
  namespace Cypress {
    interface Chainable {
      demoStep(message: string, options?: { delayMs?: number; highlight?: string }): Chainable<void>;
      demoPause(delayMs?: number): Chainable<void>;
      demoCleanup(): Chainable<void>;
    }
  }
}

Cypress.Commands.add('demoStep', (message: string, options = {}) => {
  cy.log(`[demo] ${message}`);

  if (!isDemoModeEnabled()) {
    return cy.wrap(undefined, { log: false });
  }

  return cy.window({ log: false }).then(window => {
    const overlay = ensureDemoOverlay(window.document);
    const messageNode = overlay.querySelector('#cy-demo-overlay-message');

    if (messageNode) {
      messageNode.textContent = message;
    }

    applyDemoHighlight(window.document, options.highlight);

    overlay.style.opacity = '1';
    overlay.style.transform = 'translateY(0)';

    return cy.wait(getDemoDelayMs(options.delayMs), { log: false });
  });
});

Cypress.Commands.add('demoPause', (delayMs?: number) => {
  if (!isDemoModeEnabled()) {
    return cy.wrap(undefined, { log: false });
  }

  return cy.wait(getDemoDelayMs(delayMs), { log: false });
});

Cypress.Commands.add('demoCleanup', () => {
  return cy.window({ log: false }).then(window => {
    clearDemoHighlights(window.document);
    window.document.getElementById('cy-demo-overlay')?.remove();
  });
});
