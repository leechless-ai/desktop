export function initSettingsModule({
  elements,
  safeObject,
  safeNumber,
  safeString,
  getDashboardData,
  getDashboardPort,
}) {
  let configFormPopulated = false;

  function populateSettingsForm(config) {
    if (!config || configFormPopulated) return;
    configFormPopulated = true;

    const seller = safeObject(config.seller) ?? {};
    const buyer = safeObject(config.buyer) ?? {};
    const payments = safeObject(config.payments) ?? {};

    if (elements.cfgReserveFloor) elements.cfgReserveFloor.value = safeNumber(seller.reserveFloor, 0);
    if (elements.cfgPricePerToken) elements.cfgPricePerToken.value = safeNumber(seller.pricePerToken, 0);
    if (elements.cfgMaxBuyers) elements.cfgMaxBuyers.value = safeNumber(seller.maxConcurrentBuyers, 1);
    if (elements.cfgProxyPort) elements.cfgProxyPort.value = safeNumber(buyer.proxyPort, 8080);
    if (elements.cfgMaxPrice) elements.cfgMaxPrice.value = safeNumber(buyer.maxPricePerToken, 0);
    if (elements.cfgMinRep) elements.cfgMinRep.value = safeNumber(buyer.minPeerReputation, 0);
    if (elements.cfgPaymentMethod) elements.cfgPaymentMethod.value = safeString(payments.preferredMethod, 'crypto');
  }

  function getSettingsFromForm() {
    return {
      seller: {
        reserveFloor: parseInt(elements.cfgReserveFloor?.value ?? '0', 10) || 0,
        pricePerToken: parseFloat(elements.cfgPricePerToken?.value ?? '0') || 0,
        maxConcurrentBuyers: parseInt(elements.cfgMaxBuyers?.value ?? '1', 10) || 1,
      },
      buyer: {
        proxyPort: parseInt(elements.cfgProxyPort?.value ?? '8080', 10) || 8080,
        maxPricePerToken: parseFloat(elements.cfgMaxPrice?.value ?? '0') || 0,
        minPeerReputation: parseInt(elements.cfgMinRep?.value ?? '0', 10) || 0,
      },
    };
  }

  function showConfigMessage(text, type) {
    if (!elements.configMessage) return;
    elements.configMessage.textContent = text;
    elements.configMessage.className = `message settings-message ${type}`;
    setTimeout(() => {
      if (elements.configMessage.textContent === text) {
        elements.configMessage.textContent = '';
        elements.configMessage.className = 'message';
      }
    }, 5000);
  }

  async function saveConfig() {
    const configData = getSettingsFromForm();
    const saveBtn = elements.configSaveBtn;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      const result = await getDashboardData('config');
      if (!result.ok) {
        showConfigMessage('Failed to read current config', 'error');
        return;
      }

      const currentConfig = result.data?.config ?? result.data;
      const merged = { ...currentConfig, ...configData };

      const port = getDashboardPort();
      const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });

      if (response.ok) {
        showConfigMessage('Configuration saved successfully', 'success');
        configFormPopulated = false;
      } else {
        showConfigMessage('Failed to save configuration', 'error');
      }
    } catch (err) {
      showConfigMessage(`Error saving: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    }
  }

  if (elements.configSaveBtn) {
    elements.configSaveBtn.addEventListener('click', () => {
      void saveConfig();
    });
  }

  return {
    populateSettingsForm,
  };
}
