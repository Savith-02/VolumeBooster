// content.js - Updated to prevent audio disruption when disabled
(function () {
  let audioContext = null;
  let gainNode = null;
  let compressorNode = null; // Added compressor node
  let limiterNode = null; // Added limiter node
  let mediaElements = [];
  let audioSources = [];
  let boosterEnabled = false;
  let floatingUIVisible = false;
  let floatingUI = null;
  let currentGain = 2.0; // Default gain value (2x)
  let errorNotificationTimeout = null;

  // Compressor settings
  let compressorThreshold = -24; // dB
  let compressorRatio = 4; // ratio
  let compressorKnee = 5; // dB
  let compressorAttack = 0.003; // seconds
  let compressorRelease = 0.25; // seconds

  // Limiter settings
  let limiterThreshold = -0.5; // dB (just below 0 to prevent clipping)
  let limiterAttack = 0.0005; // seconds (even faster attack to catch transients at high gain)
  let limiterRelease = 0.05; // seconds (faster release for high gain settings)

  // Initialize from storage
  chrome.storage.local.get(
    [
      "boosterEnabled",
      "floatingUIVisible",
      "gainValue",
      "compressorSettings",
      "limiterSettings",
    ],
    function (result) {
      boosterEnabled = result.boosterEnabled || false;
      floatingUIVisible = result.floatingUIVisible || false;
      currentGain = result.gainValue || 2.0;

      // Load compressor settings if available
      if (result.compressorSettings) {
        compressorThreshold =
          result.compressorSettings.threshold || compressorThreshold;
        compressorRatio = result.compressorSettings.ratio || compressorRatio;
        compressorKnee = result.compressorSettings.knee || compressorKnee;
        compressorAttack = result.compressorSettings.attack || compressorAttack;
        compressorRelease =
          result.compressorSettings.release || compressorRelease;
      }

      // Load limiter settings if available
      if (result.limiterSettings) {
        limiterThreshold = result.limiterSettings.threshold || limiterThreshold;
        limiterAttack = result.limiterSettings.attack || limiterAttack;
        limiterRelease = result.limiterSettings.release || limiterRelease;
      }

      if (floatingUIVisible) {
        createFloatingUI();
      }

      try {
        setupAudioContext();
        processExistingAudio();
        setupAudioObserver();

        // Apply appropriate gain based on status
        if (gainNode) {
          updateAudioProcessingChain();
        }

        // Re-scan for audio elements periodically to catch dynamically added elements
        setInterval(() => {
          processExistingAudio();
        }, 5000);
      } catch (e) {
        showError("Failed to initialize audio booster: " + e.message);
        console.error("Volume Booster initialization error:", e);
      }
    }
  );

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "toggleBooster") {
      boosterEnabled = request.enabled;
      chrome.storage.local.set({ boosterEnabled: boosterEnabled });

      try {
        // Instead of disconnecting, just set gain to 1.0 when disabled
        if (!audioContext) {
          setupAudioContext();
        }

        if (gainNode) {
          updateAudioProcessingChain();
        }

        processExistingAudio();
        setupAudioObserver();
        updateStatus();
      } catch (e) {
        showError(
          boosterEnabled
            ? "Failed to enable audio booster: " + e.message
            : "Failed to disable audio booster: " + e.message
        );
        console.error("Volume Booster toggle error:", e);
      }

      sendResponse({ success: true });
    } else if (request.action === "toggleFloatingUI") {
      floatingUIVisible = !floatingUIVisible;
      chrome.storage.local.set({ floatingUIVisible: floatingUIVisible });

      if (floatingUIVisible) {
        createFloatingUI();
      } else if (floatingUI) {
        document.body.removeChild(floatingUI);
        floatingUI = null;
      }
      sendResponse({ success: true });
    } else if (request.action === "updateGain") {
      currentGain = request.value;
      chrome.storage.local.set({ gainValue: currentGain });

      // Only apply new gain if booster is enabled
      if (boosterEnabled && gainNode) {
        updateAudioProcessingChain();
      }

      sendResponse({ success: true });
    } else if (request.action === "updateCompressor") {
      // Handle compressor settings updates
      if (request.settings) {
        if (request.settings.threshold !== undefined)
          compressorThreshold = request.settings.threshold;
        if (request.settings.ratio !== undefined)
          compressorRatio = request.settings.ratio;
        if (request.settings.knee !== undefined)
          compressorKnee = request.settings.knee;
        if (request.settings.attack !== undefined)
          compressorAttack = request.settings.attack;
        if (request.settings.release !== undefined)
          compressorRelease = request.settings.release;

        chrome.storage.local.set({
          compressorSettings: {
            threshold: compressorThreshold,
            ratio: compressorRatio,
            knee: compressorKnee,
            attack: compressorAttack,
            release: compressorRelease,
          },
        });

        if (boosterEnabled && compressorNode) {
          updateCompressorSettings();
        }
      }

      sendResponse({ success: true });
    } else if (request.action === "updateLimiter") {
      // Handle limiter settings updates
      if (request.settings) {
        if (request.settings.threshold !== undefined)
          limiterThreshold = request.settings.threshold;
        if (request.settings.attack !== undefined)
          limiterAttack = request.settings.attack;
        if (request.settings.release !== undefined)
          limiterRelease = request.settings.release;

        chrome.storage.local.set({
          limiterSettings: {
            threshold: limiterThreshold,
            attack: limiterAttack,
            release: limiterRelease,
          },
        });

        if (boosterEnabled && limiterNode) {
          updateLimiterSettings();
        }
      }

      sendResponse({ success: true });
    }
    return true; // Keep the message channel open for async response
  });

  function updateStatus() {
    if (!floatingUI) return;

    const statusText = floatingUI.querySelector(".volume-booster-status-text");
    if (statusText) {
      statusText.textContent = `Status: ${
        boosterEnabled ? "Active" : "Inactive"
      }`;
      statusText.style.backgroundColor = boosterEnabled ? "#e6f4ea" : "#f8f9fa";
      statusText.style.color = boosterEnabled ? "#137333" : "#666";
      statusText.style.border = `1px solid ${
        boosterEnabled ? "#ceead6" : "#dadce0"
      }`;
    }
  }

  // Create and set up Web Audio API context
  function setupAudioContext() {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Create nodes
        gainNode = audioContext.createGain();
        compressorNode = audioContext.createDynamicsCompressor();
        limiterNode = audioContext.createDynamicsCompressor(); // Using compressor as limiter

        // Set up compressor
        updateCompressorSettings();

        // Set up limiter
        updateLimiterSettings();

        // Connect the audio processing chain
        updateAudioProcessingChain();
      } catch (e) {
        console.error("Failed to create audio context:", e);
        throw e;
      }
    }
  }

  // Update compressor settings
  function updateCompressorSettings() {
    if (compressorNode) {
      compressorNode.threshold.value = compressorThreshold;
      compressorNode.ratio.value = compressorRatio;
      compressorNode.knee.value = compressorKnee;
      compressorNode.attack.value = compressorAttack;
      compressorNode.release.value = compressorRelease;
    }
  }

  // Update limiter settings
  function updateLimiterSettings() {
    if (limiterNode) {
      // Configure compressor as a limiter with high ratio
      limiterNode.threshold.value = limiterThreshold;
      limiterNode.ratio.value = 25; // Higher ratio for more aggressive limiting at high gain
      limiterNode.knee.value = 0.05; // Harder knee for more precise limiting
      limiterNode.attack.value = limiterAttack;
      limiterNode.release.value = limiterRelease;
    }
  }

  // Update the audio processing chain based on whether booster is enabled
  function updateAudioProcessingChain() {
    try {
      // Disconnect all nodes first
      gainNode.disconnect();
      compressorNode.disconnect();
      limiterNode.disconnect();

      if (boosterEnabled) {
        // Set gain value
        gainNode.gain.value = currentGain;

        // Adjust limiter threshold based on gain level for better protection at high gain
        if (currentGain > 5) {
          // More aggressive limiting for very high gain
          limiterNode.threshold.value = Math.min(limiterThreshold, -2.0);
          limiterNode.ratio.value = 30; // Even higher ratio for extreme gain
        } else {
          // Normal limiting for moderate gain
          limiterNode.threshold.value = limiterThreshold;
          limiterNode.ratio.value = 25;
        }

        // Connect the processing chain: source -> gain -> compressor -> limiter -> destination
        gainNode.connect(compressorNode);
        compressorNode.connect(limiterNode);
        limiterNode.connect(audioContext.destination);
      } else {
        // When disabled, set gain to 1.0 and bypass compressor/limiter
        gainNode.gain.value = 1.0;
        gainNode.connect(audioContext.destination);
      }
    } catch (e) {
      console.error("Error updating audio processing chain:", e);
      showError("Failed to update audio processing: " + e.message);
    }
  }

  // Process all existing audio elements on the page
  function processExistingAudio() {
    try {
      const audioTags = document.querySelectorAll("audio, video");
      audioTags.forEach(connectAudioElement);

      // Search for audio elements inside Shadow DOM
      findAudioInShadows(document.body);
    } catch (e) {
      console.error("Error processing existing audio:", e);
      showError("Error finding audio elements: " + e.message);
    }
  }

  // Find audio elements in Shadow DOM
  function findAudioInShadows(node) {
    if (!node) return;

    if (node.shadowRoot) {
      try {
        const shadowAudio = node.shadowRoot.querySelectorAll("audio, video");
        shadowAudio.forEach(connectAudioElement);

        // Recursively check child nodes in shadow root
        node.shadowRoot.querySelectorAll("*").forEach(findAudioInShadows);
      } catch (e) {
        console.error("Shadow DOM access error:", e);
      }
    }

    // Check child nodes
    if (node.children) {
      Array.from(node.children).forEach(findAudioInShadows);
    }
  }

  // Connect audio element to our audio context
  function connectAudioElement(element) {
    if (!element || mediaElements.includes(element)) return;

    try {
      // Check if element is valid
      if (!(element instanceof HTMLMediaElement)) {
        return;
      }

      const source = audioContext.createMediaElementSource(element);
      source.connect(gainNode);
      mediaElements.push(element);
      audioSources.push(source);

      // Add event listener for source changes
      element.addEventListener("srcchange", () => {
        try {
          // Reconnect when source changes
          connectAudioElement(element);
        } catch (e) {
          console.error("Source change reconnection error:", e);
        }
      });
    } catch (e) {
      console.error("Error connecting audio element:", e);
      // Only show UI error for non-duplicate element errors
      if (!e.message.includes("already connected")) {
        showError("Failed to boost audio: " + e.message);
      }
    }
  }

  // Update gain value for all connected audio
  function updateGain() {
    updateAudioProcessingChain();
  }

  // Observe DOM for newly added audio/video elements
  function setupAudioObserver() {
    try {
      const observer = new MutationObserver(function (mutations) {
        let newAudioFound = false;

        mutations.forEach(function (mutation) {
          if (mutation.addedNodes) {
            mutation.addedNodes.forEach(function (node) {
              if (node.tagName === "AUDIO" || node.tagName === "VIDEO") {
                connectAudioElement(node);
                newAudioFound = true;
              } else if (node.querySelectorAll) {
                try {
                  const audioTags = node.querySelectorAll("audio, video");
                  if (audioTags.length > 0) {
                    audioTags.forEach(connectAudioElement);
                    newAudioFound = true;
                  }

                  // Check for Shadow DOM in new nodes
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    findAudioInShadows(node);
                  }
                } catch (e) {
                  console.error("Error processing mutation:", e);
                }
              }
            });
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.error("Error setting up observer:", e);
      showError("Failed to monitor for new audio: " + e.message);
    }
  }

  // Show error notification in UI
  function showError(message) {
    if (!floatingUI) {
      // Create temporary notification if floating UI is not visible
      const notification = document.createElement("div");
      notification.className = "volume-booster-notification";
      notification.textContent = "Volume Booster: " + message;
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: rgba(200, 0, 0, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 10000000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        max-width: 300px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      `;

      document.body.appendChild(notification);

      // Remove notification after 5 seconds
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 5000);
    } else {
      // Show error in floating UI
      const errorElement = floatingUI.querySelector(".volume-booster-error");
      if (!errorElement) {
        const errorDiv = document.createElement("div");
        errorDiv.className = "volume-booster-error";
        errorDiv.style.cssText = `
          background-color: rgba(200, 0, 0, 0.8);
          color: white;
          padding: 5px 10px;
          margin-top: 8px;
          border-radius: 4px;
          font-size: 12px;
          text-align: center;
        `;
        errorDiv.textContent = message;
        floatingUI
          .querySelector(".volume-booster-content")
          .appendChild(errorDiv);

        // Clear previous timeout
        if (errorNotificationTimeout) {
          clearTimeout(errorNotificationTimeout);
        }

        // Remove error after 5 seconds
        errorNotificationTimeout = setTimeout(() => {
          if (errorElement && errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
          }
        }, 5000);
      } else {
        errorElement.textContent = message;

        // Reset timeout
        if (errorNotificationTimeout) {
          clearTimeout(errorNotificationTimeout);
        }

        errorNotificationTimeout = setTimeout(() => {
          if (errorElement && errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
          }
        }, 5000);
      }
    }
  }

  // Create floating UI control
  function createFloatingUI() {
    if (floatingUI) return;

    try {
      floatingUI = document.createElement("div");
      floatingUI.className = "volume-booster-floating-ui";
      floatingUI.innerHTML = `
        <div class="volume-booster-header">
          <span>Volume Booster</span>
          <button class="volume-booster-close">×</button>
        </div>
        <div class="volume-booster-content">
          <div class="volume-booster-main-controls">
            <div class="volume-booster-slider-container">
              <label>Loudness Level</label>
              <div class="volume-booster-slider-with-value">
                <input type="range" min="1" max="7" step="0.1" value="${currentGain}" class="volume-booster-slider">
                <span class="volume-booster-value">${currentGain}x</span>
              </div>
              <div class="volume-booster-slider-labels">
                <span>Normal</span>
                <span>Maximum</span>
              </div>
            </div>
            <div class="volume-booster-presets">
              <label>Quick Volume Levels</label>
              <div class="volume-booster-preset-buttons">
                <button class="volume-booster-preset" data-value="1.5">Slight</button>
                <button class="volume-booster-preset" data-value="3">Medium</button>
                <button class="volume-booster-preset" data-value="5">Loud</button>
                <button class="volume-booster-preset" data-value="7">Maximum</button>
              </div>
            </div>
          </div>
          
          <div class="volume-booster-toggle">
            <label class="volume-booster-switch">
              <input type="checkbox" class="volume-booster-checkbox" ${
                boosterEnabled ? "checked" : ""
              }>
              <span class="volume-booster-slider-toggle"></span>
            </label>
            <span class="volume-booster-toggle-label">${
              boosterEnabled ? "Booster On" : "Booster Off"
            }</span>
          </div>
          
          <div class="volume-booster-advanced">
            <details>
              <summary>Sound Quality Enhancer</summary>
              <div class="volume-booster-advanced-content">
                <div class="volume-booster-section">
                  <h4>Clarity Enhancer</h4>
                  <p class="volume-booster-description">Makes quiet parts more audible without distorting loud parts</p>
                  <div class="volume-booster-setting">
                    <label>Clarity Level: <span class="threshold-value">${
                      Math.abs(compressorThreshold) < 15
                        ? "Low"
                        : Math.abs(compressorThreshold) < 30
                        ? "Medium"
                        : "High"
                    }</span></label>
                    <input type="range" min="-50" max="-5" step="1" value="${compressorThreshold}" class="compressor-threshold">
                    <div class="volume-booster-slider-labels">
                      <span>High</span>
                      <span>Low</span>
                    </div>
                  </div>
                  <div class="volume-booster-setting">
                    <label>Balance Effect: <span class="ratio-value">${
                      compressorRatio <= 2
                        ? "Subtle"
                        : compressorRatio <= 6
                        ? "Moderate"
                        : "Strong"
                    }</span></label>
                    <input type="range" min="1" max="20" step="0.5" value="${compressorRatio}" class="compressor-ratio">
                    <div class="volume-booster-slider-labels">
                      <span>Subtle</span>
                      <span>Strong</span>
                    </div>
                  </div>
                </div>
                
                <div class="volume-booster-section">
                  <h4>Anti-Distortion Shield</h4>
                  <p class="volume-booster-description">Prevents crackling and harshness at high volumes</p>
                  <div class="volume-booster-setting">
                    <label>Protection Strength: <span class="limiter-threshold-value">${
                      limiterThreshold >= -1
                        ? "Light"
                        : limiterThreshold >= -3
                        ? "Medium"
                        : "Strong"
                    }</span></label>
                    <input type="range" min="-6" max="0" step="0.1" value="${limiterThreshold}" class="limiter-threshold">
                    <div class="volume-booster-slider-labels">
                      <span>Strong</span>
                      <span>Light</span>
                    </div>
                  </div>
                </div>
                
                <div class="volume-booster-recommended">
                  <button class="volume-booster-recommended-button" data-preset="music">Music Optimized</button>
                  <button class="volume-booster-recommended-button" data-preset="voice">Voice Optimized</button>
                  <button class="volume-booster-recommended-button" data-preset="movie">Movie Optimized</button>
                  <button class="volume-booster-recommended-button" data-preset="extreme">Extreme Boost</button>
                </div>
                
                <div class="volume-booster-info">
                  <p>These settings help you hear everything clearly without distortion, even at high volumes.</p>
                  <p class="volume-booster-high-gain-warning ${
                    currentGain > 5 ? "visible" : "hidden"
                  }">
                    <strong>High Gain Alert:</strong> At maximum levels, use the "Extreme Boost" preset for best sound quality.
                  </p>
                </div>
              </div>
            </details>
          </div>
        </div>
      `;

      // Add styling
      const style = document.createElement("style");
      style.textContent = `
        .volume-booster-floating-ui {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 300px;
          background-color: #fff;
          border: 1px solid #ccc;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          z-index: 9999999;
          font-family: Arial, sans-serif;
          user-select: none;
        }
        .volume-booster-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 15px;
          background-color: #4285f4;
          color: white;
          border-top-left-radius: 12px;
          border-top-right-radius: 12px;
          cursor: move;
          font-weight: bold;
          font-size: 15px;
        }
        .volume-booster-close {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .volume-booster-content {
          padding: 18px;
        }
        .volume-booster-main-controls {
          margin-bottom: 18px;
        }
        .volume-booster-slider-container {
          margin-bottom: 15px;
        }
        .volume-booster-slider-container label,
        .volume-booster-presets label {
          display: block;
          margin-bottom: 8px;
          font-weight: bold;
          color: #333;
          font-size: 14px;
        }
        .volume-booster-slider-with-value {
          display: flex;
          align-items: center;
          margin-bottom: 4px;
        }
        .volume-booster-slider {
          flex: 1;
          margin-right: 12px;
          height: 8px;
          -webkit-appearance: none;
          appearance: none;
          background: #e0e0e0;
          border-radius: 4px;
          outline: none;
        }
        .volume-booster-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #4285f4;
          cursor: pointer;
          border: none;
        }
        .volume-booster-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #4285f4;
          cursor: pointer;
          border: none;
        }
        .volume-booster-slider-labels {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #666;
          margin-top: 2px;
        }
        .volume-booster-value {
          font-weight: bold;
          min-width: 35px;
          color: #4285f4;
          font-size: 15px;
        }
        .volume-booster-presets {
          margin-bottom: 15px;
        }
        .volume-booster-preset-buttons {
          display: flex;
          justify-content: space-between;
        }
        .volume-booster-preset {
          background-color: #f1f3f4;
          border: none;
          border-radius: 20px;
          padding: 8px 0;
          cursor: pointer;
          color: #444;
          font-weight: bold;
          flex: 1;
          margin: 0 4px;
          transition: all 0.2s;
          font-size: 12px;
        }
        .volume-booster-preset:first-child {
          margin-left: 0;
        }
        .volume-booster-preset:last-child {
          margin-right: 0;
        }
        .volume-booster-preset:hover {
          background-color: #e8eaed;
        }
        .volume-booster-preset.active {
          background-color: #4285f4;
          color: white;
        }
        .volume-booster-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 15px 0;
        }
        .volume-booster-switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 24px;
          margin-right: 10px;
        }
        .volume-booster-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .volume-booster-slider-toggle {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .4s;
          border-radius: 24px;
        }
        .volume-booster-slider-toggle:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        .volume-booster-checkbox:checked + .volume-booster-slider-toggle {
          background-color: #4285f4;
        }
        .volume-booster-checkbox:checked + .volume-booster-slider-toggle:before {
          transform: translateX(26px);
        }
        .volume-booster-toggle-label {
          font-weight: bold;
          font-size: 14px;
          color: ${boosterEnabled ? "#4285f4" : "#666"};
        }
        .volume-booster-advanced {
          margin-top: 15px;
          border-top: 1px solid #eee;
          padding-top: 15px;
        }
        .volume-booster-advanced summary {
          cursor: pointer;
          color: #4285f4;
          font-weight: bold;
          outline: none;
          padding: 5px 0;
          font-size: 14px;
        }
        .volume-booster-advanced summary:hover {
          color: #3367d6;
        }
        .volume-booster-advanced-content {
          padding: 15px 0 5px;
        }
        .volume-booster-section {
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid #f0f0f0;
        }
        .volume-booster-section:last-of-type {
          border-bottom: none;
          margin-bottom: 10px;
        }
        .volume-booster-section h4 {
          margin: 0 0 5px 0;
          font-size: 14px;
          color: #333;
        }
        .volume-booster-description {
          margin: 0 0 12px 0;
          font-size: 12px;
          color: #666;
          line-height: 1.4;
        }
        .volume-booster-setting {
          margin-bottom: 15px;
        }
        .volume-booster-setting:last-child {
          margin-bottom: 0;
        }
        .volume-booster-setting label {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
          color: #444;
        }
        .volume-booster-setting input {
          width: 100%;
          margin-bottom: 3px;
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          background: #e0e0e0;
          border-radius: 4px;
          outline: none;
        }
        .volume-booster-setting input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #4285f4;
          cursor: pointer;
        }
        .volume-booster-setting input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #4285f4;
          cursor: pointer;
          border: none;
        }
        .volume-booster-recommended {
          display: flex;
          justify-content: space-between;
          margin-bottom: 15px;
        }
        .volume-booster-recommended-button {
          flex: 1;
          margin: 0 4px;
          padding: 8px 0;
          background-color: #f1f3f4;
          border: none;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          color: #444;
          cursor: pointer;
          transition: all 0.2s;
        }
        .volume-booster-recommended-button:first-child {
          margin-left: 0;
        }
        .volume-booster-recommended-button:last-child {
          margin-right: 0;
        }
        .volume-booster-recommended-button:hover {
          background-color: #e8eaed;
        }
        .volume-booster-info {
          background-color: #f8f9fa;
          border: 1px solid #dadce0;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 12px;
          color: #444;
          line-height: 1.4;
        }
        .volume-booster-info p {
          margin: 0;
        }
        .volume-booster-error {
          background-color: rgba(200, 0, 0, 0.8);
          color: white;
          padding: 10px 12px;
          margin-top: 12px;
          border-radius: 8px;
          font-size: 12px;
          text-align: center;
          line-height: 1.4;
        }
        .volume-booster-high-gain-warning {
          margin-top: 8px;
          padding: 6px 8px;
          background-color: #fff3e0;
          border: 1px solid #ffcc80;
          border-radius: 4px;
          color: #e65100;
          font-size: 11px;
          line-height: 1.4;
          transition: opacity 0.3s;
        }
        
        .volume-booster-high-gain-warning.hidden {
          display: none;
        }
        
        .volume-booster-high-gain-warning.visible {
          display: block;
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(floatingUI);

      // Make UI draggable
      let isDragging = false;
      let offsetX, offsetY;

      const header = floatingUI.querySelector(".volume-booster-header");
      header.addEventListener("mousedown", function (e) {
        isDragging = true;
        offsetX = e.clientX - floatingUI.getBoundingClientRect().left;
        offsetY = e.clientY - floatingUI.getBoundingClientRect().top;
      });

      document.addEventListener("mousemove", function (e) {
        if (!isDragging) return;

        floatingUI.style.left = e.clientX - offsetX + "px";
        floatingUI.style.top = e.clientY - offsetY + "px";
        floatingUI.style.right = "auto";
      });

      document.addEventListener("mouseup", function () {
        isDragging = false;
      });

      // Handle close button
      const closeButton = floatingUI.querySelector(".volume-booster-close");
      closeButton.addEventListener("click", function () {
        floatingUIVisible = false;
        chrome.storage.local.set({ floatingUIVisible: false });
        document.body.removeChild(floatingUI);
        floatingUI = null;
      });

      // Handle toggle switch
      const toggleCheckbox = floatingUI.querySelector(
        ".volume-booster-checkbox"
      );
      const toggleLabel = floatingUI.querySelector(
        ".volume-booster-toggle-label"
      );

      toggleCheckbox.addEventListener("change", function () {
        boosterEnabled = toggleCheckbox.checked;
        toggleLabel.textContent = boosterEnabled ? "Booster On" : "Booster Off";
        toggleLabel.style.color = boosterEnabled ? "#4285f4" : "#666";

        chrome.storage.local.set({ boosterEnabled: boosterEnabled });

        if (gainNode) {
          updateAudioProcessingChain();
        }

        // Update preset buttons to show active state
        updatePresetButtonStates();
      });

      // Handle slider
      const slider = floatingUI.querySelector(".volume-booster-slider");
      const valueDisplay = floatingUI.querySelector(".volume-booster-value");

      slider.addEventListener("input", function () {
        currentGain = parseFloat(slider.value);
        valueDisplay.textContent = currentGain.toFixed(1) + "x";

        // Show warning for high gain levels
        const highGainWarning = floatingUI.querySelector(
          ".volume-booster-high-gain-warning"
        );
        if (highGainWarning) {
          if (currentGain > 5) {
            highGainWarning.classList.remove("hidden");
            highGainWarning.classList.add("visible");
          } else {
            highGainWarning.classList.remove("visible");
            highGainWarning.classList.add("hidden");
          }
        }

        // Only update gain if booster is enabled
        if (boosterEnabled) {
          updateAudioProcessingChain();
        }
        chrome.storage.local.set({ gainValue: currentGain });

        // Update preset buttons to show active state
        updatePresetButtonStates();
      });

      // Handle preset buttons
      const presetButtons = floatingUI.querySelectorAll(
        ".volume-booster-preset"
      );

      function updatePresetButtonStates() {
        presetButtons.forEach((button) => {
          const buttonValue = parseFloat(button.dataset.value);
          if (Math.abs(currentGain - buttonValue) < 0.1) {
            button.classList.add("active");
          } else {
            button.classList.remove("active");
          }
        });
      }

      // Initialize preset button states
      updatePresetButtonStates();

      presetButtons.forEach((button) => {
        button.addEventListener("click", function () {
          currentGain = parseFloat(button.dataset.value);
          slider.value = currentGain;
          valueDisplay.textContent = currentGain.toFixed(1) + "x";

          // Update active states
          updatePresetButtonStates();

          // Only update gain if booster is enabled
          if (boosterEnabled) {
            updateAudioProcessingChain();
          }
          chrome.storage.local.set({ gainValue: currentGain });
        });
      });

      // Handle compressor threshold slider
      const thresholdSlider = floatingUI.querySelector(".compressor-threshold");
      const thresholdDisplay = floatingUI.querySelector(".threshold-value");

      if (thresholdSlider && thresholdDisplay) {
        thresholdSlider.addEventListener("input", function () {
          compressorThreshold = parseFloat(thresholdSlider.value);

          // Convert technical value to user-friendly term
          let thresholdTerm = "Low";
          if (Math.abs(compressorThreshold) >= 30) {
            thresholdTerm = "High";
          } else if (Math.abs(compressorThreshold) >= 15) {
            thresholdTerm = "Medium";
          }

          thresholdDisplay.textContent = thresholdTerm;

          if (boosterEnabled && compressorNode) {
            updateCompressorSettings();
          }

          chrome.storage.local.set({
            compressorSettings: {
              threshold: compressorThreshold,
              ratio: compressorRatio,
              knee: compressorKnee,
              attack: compressorAttack,
              release: compressorRelease,
            },
          });
        });
      }

      // Handle compressor ratio slider
      const ratioSlider = floatingUI.querySelector(".compressor-ratio");
      const ratioDisplay = floatingUI.querySelector(".ratio-value");

      if (ratioSlider && ratioDisplay) {
        ratioSlider.addEventListener("input", function () {
          compressorRatio = parseFloat(ratioSlider.value);

          // Convert technical value to user-friendly term
          let ratioTerm = "Subtle";
          if (compressorRatio > 6) {
            ratioTerm = "Strong";
          } else if (compressorRatio > 2) {
            ratioTerm = "Moderate";
          }

          ratioDisplay.textContent = ratioTerm;

          if (boosterEnabled && compressorNode) {
            updateCompressorSettings();
          }

          chrome.storage.local.set({
            compressorSettings: {
              threshold: compressorThreshold,
              ratio: compressorRatio,
              knee: compressorKnee,
              attack: compressorAttack,
              release: compressorRelease,
            },
          });
        });
      }

      // Handle limiter threshold slider
      const limiterThresholdSlider =
        floatingUI.querySelector(".limiter-threshold");
      const limiterThresholdDisplay = floatingUI.querySelector(
        ".limiter-threshold-value"
      );

      if (limiterThresholdSlider && limiterThresholdDisplay) {
        limiterThresholdSlider.addEventListener("input", function () {
          limiterThreshold = parseFloat(limiterThresholdSlider.value);

          // Convert technical value to user-friendly term
          let limiterTerm = "Light";
          if (limiterThreshold < -3) {
            limiterTerm = "Strong";
          } else if (limiterThreshold < -1) {
            limiterTerm = "Medium";
          }

          limiterThresholdDisplay.textContent = limiterTerm;

          if (boosterEnabled && limiterNode) {
            updateLimiterSettings();
          }

          chrome.storage.local.set({
            limiterSettings: {
              threshold: limiterThreshold,
              attack: limiterAttack,
              release: limiterRelease,
            },
          });
        });
      }

      // Handle recommended preset buttons
      const recommendedButtons = floatingUI.querySelectorAll(
        ".volume-booster-recommended-button"
      );

      recommendedButtons.forEach((button) => {
        button.addEventListener("click", function () {
          const preset = button.dataset.preset;

          // Apply preset settings based on content type
          if (preset === "music") {
            // Music settings: moderate compression, careful limiting
            compressorThreshold = -24;
            compressorRatio = 4;
            limiterThreshold = -1.5;
          } else if (preset === "voice") {
            // Voice settings: stronger compression, moderate limiting
            compressorThreshold = -32;
            compressorRatio = 6;
            limiterThreshold = -2;
          } else if (preset === "movie") {
            // Movie settings: balanced for dynamic range
            compressorThreshold = -20;
            compressorRatio = 3;
            limiterThreshold = -1;
          } else if (preset === "extreme") {
            // Extreme settings: maximum protection for very high gain
            compressorThreshold = -35;
            compressorRatio = 8;
            limiterThreshold = -3;
          }

          // Update UI
          thresholdSlider.value = compressorThreshold;
          ratioSlider.value = compressorRatio;
          limiterThresholdSlider.value = limiterThreshold;

          // Update displays
          let thresholdTerm = "Low";
          if (Math.abs(compressorThreshold) >= 30) {
            thresholdTerm = "High";
          } else if (Math.abs(compressorThreshold) >= 15) {
            thresholdTerm = "Medium";
          }
          thresholdDisplay.textContent = thresholdTerm;

          let ratioTerm = "Subtle";
          if (compressorRatio > 6) {
            ratioTerm = "Strong";
          } else if (compressorRatio > 2) {
            ratioTerm = "Moderate";
          }
          ratioDisplay.textContent = ratioTerm;

          let limiterTerm = "Light";
          if (limiterThreshold < -3) {
            limiterTerm = "Strong";
          } else if (limiterThreshold < -1) {
            limiterTerm = "Medium";
          }
          limiterThresholdDisplay.textContent = limiterTerm;

          // Apply settings
          if (boosterEnabled) {
            updateCompressorSettings();
            updateLimiterSettings();
          }

          // Save settings
          chrome.storage.local.set({
            compressorSettings: {
              threshold: compressorThreshold,
              ratio: compressorRatio,
              knee: compressorKnee,
              attack: compressorAttack,
              release: compressorRelease,
            },
            limiterSettings: {
              threshold: limiterThreshold,
              attack: limiterAttack,
              release: limiterRelease,
            },
          });
        });
      });
    } catch (e) {
      console.error("Error creating floating UI:", e);
    }
  }
})();
