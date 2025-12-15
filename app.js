// --- Imports for Three.js ---
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// =======================
//  CONFIG
// =======================
// API key is now stored in localStorage for security (never commit keys to public repos!)
let OPENAI_API_KEY = localStorage.getItem("openai_api_key") || "";

function promptForApiKey() {
  const key = prompt("Enter your OpenAI API Key:\n\n(This will be stored locally in your browser and never sent to GitHub)");
  if (key && key.trim().startsWith("sk-")) {
    OPENAI_API_KEY = key.trim();
    localStorage.setItem("openai_api_key", OPENAI_API_KEY);
    return true;
  }
  return false;
}
const AVATAR_BASE_PATH = "./avatar/avatar/models/";
const AVATARS = [
  { id: "muhammad", label: "Muhammad", file: "muhammad.glb", gender: "male" },
  { id: "anna", label: "Anna", file: "anna.glb", gender: "female" },
  { id: "aki", label: "Aki", file: "aki.glb", gender: "male" },
  { id: "amari", label: "Amari", file: "amari.glb", gender: "female" },
  { id: "leo", label: "Leo", file: "leo.glb", gender: "male" },
  { id: "maya", label: "Maya", file: "maya.glb", gender: "female" },
  { id: "rose", label: "Rose", file: "rose.glb", gender: "female" },
  { id: "shonith", label: "Shonith", file: "shonith.glb", gender: "male" },
  { id: "tom", label: "Tom", file: "tom.glb", gender: "male" },
  { id: "wei", label: "Wei", file: "wei.glb", gender: "female" },
  { id: "zara", label: "Zara", file: "zara.glb", gender: "female" },
  { id: "zola", label: "Zola", file: "zola.glb", gender: "female" }
];
const DEFAULT_AVATAR_ID = "muhammad";

// How fast the avatar talks
const CHAR_PER_SECOND = 14;

// Mic support
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const micSupported = Boolean(SpeechRecognition);

// =======================
//  DOM REFERENCES
// =======================
const avatarContainer = document.getElementById("avatar-container");
const avatarLoading = document.getElementById("avatar-loading");
const avatarSelect = document.getElementById("avatar-select");
const output = document.getElementById("output");
const btnSpeak = document.getElementById("btn-speak");
const btnPaths = document.getElementById("btn-paths");
const statusEl = document.getElementById("status");
const stopSpeechBtn = document.getElementById("stop-speech");

const inputModal = document.getElementById("input-modal");
const inputTitle = document.getElementById("input-title");
const inputSubtitle = document.getElementById("input-subtitle");
const inputTextarea = document.getElementById("input-textarea");
const inputSubmit = document.getElementById("input-submit");
const inputClose = document.getElementById("input-close");
const inputModeButtons = document.querySelectorAll(".input-switch button");
const micStatus = document.getElementById("mic-status");

// =======================
//  THREE.JS SCENE SETUP
// =======================
let scene, camera, renderer;
let model;
let animationLoopStarted = false;

// Morph targets
let mouthParts = [];
let eyeParts = [];
let smileParts = [];
let browParts = [];

// Bones
let chestBone = null;
let shoulderL = null;
let shoulderR = null;

// Animation state
let isTalking = false;
let mouthValue = 0;
let smileValue = 0.3;
let browValue = 0.0;

let nextBlinkTime = Date.now() + 2000 + Math.random() * 1200;

let headTarget = { x: 0, y: 0 };
let lastPointerLookTime = 0;
let nextIdleHeadTurn = Date.now() + 3500;

// speech timing
let speakStartTime = 0;
let speakDuration = 1;

// Mouse / touch tracking
let pointerInAvatar = false;
let pointerNorm = { x: 0, y: 0 };

// Avatar selection
let currentAvatarId = DEFAULT_AVATAR_ID;

// Input modal state
let activeInputMode = micSupported ? "mic" : "text";
let resolveInput = null;
let recognition = null;
let isRecording = false;
let currentTranscript = "";
let currentUtterance = null;
let preferredVoice = null;
let availableVoices = [];

// =======================
//  INIT
// =======================
setStatus("Loading avatar...");
setStopButton(false);
initAvatar();
setupAvatarPicker();
setupButtons();
setupInputModal();
initVoiceSelection();

// =======================
//  AVATAR INIT
// =======================
function initAvatar() {
  if (!avatarContainer) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  camera = new THREE.PerspectiveCamera(
    45,
    avatarContainer.clientWidth / avatarContainer.clientHeight,
    0.1,
    100
  );

  camera.position.set(0, 1.7, 0.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(avatarContainer.clientWidth, avatarContainer.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  avatarContainer.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  startAnimationLoop();
  loadAvatar(DEFAULT_AVATAR_ID);

  window.addEventListener("resize", () => {
    if (!camera || !renderer) return;
    camera.aspect = avatarContainer.clientWidth / avatarContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(avatarContainer.clientWidth, avatarContainer.clientHeight);
  });

  avatarContainer.addEventListener("pointerenter", () => {
    pointerInAvatar = true;
  });
  avatarContainer.addEventListener("pointerleave", () => {
    pointerInAvatar = false;
  });
  avatarContainer.addEventListener("pointermove", (e) => {
    const rect = avatarContainer.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    pointerNorm.x = x * 2 - 1;
    pointerNorm.y = y * 2 - 1;
    lastPointerLookTime = Date.now();
  });
}

// =======================
//  AVATAR LOADER
// =======================
function loadAvatar(avatarId) {
  if (!scene) return;

  const avatar = AVATARS.find((a) => a.id === avatarId) || AVATARS[0];
  if (!avatar) return;

  if (currentAvatarId === avatar.id && model) return;
  currentAvatarId = avatar.id;
  selectVoiceForAvatar(currentAvatarId);

  if (avatarSelect && avatarSelect.value !== avatar.id) {
    avatarSelect.value = avatar.id;
  }

  if (avatarLoading) {
    avatarLoading.style.display = "flex";
    avatarLoading.textContent = `Loading ${avatar.label}...`;
  }
  setStatus(`Loading ${avatar.label}...`);

  mouthParts = [];
  eyeParts = [];
  smileParts = [];
  browParts = [];
  chestBone = null;
  shoulderL = null;
  shoulderR = null;

  if (model) {
    scene.remove(model);
    disposeModel(model);
    model = null;
  }

  const loader = new GLTFLoader();
  loader.load(
    `${AVATAR_BASE_PATH}${avatar.file}`,
    (gltf) => {
      if (avatar.id !== currentAvatarId) {
        disposeModel(gltf.scene);
        return;
      }

      model = gltf.scene;
      scene.add(model);
      if (avatarLoading) avatarLoading.style.display = "none";
      setStatus("Ready");

      const mouthNames = [
        "jawOpen",
        "mouthOpen",
        "viseme_aa",
        "viseme_OH",
        "MouthOpen",
        "v_aa"
      ];
      const eyeNames = [
        "eyeBlinkLeft",
        "eyeBlinkRight",
        "eyesClosed",
        "blink",
        "EyeBlink_L",
        "EyeBlink_R"
      ];
      const smileNames = [
        "smile",
        "smileWide",
        "mouthSmile",
        "mouthSmileLeft",
        "mouthSmileBig",
        "mouthSmileRight"
      ];
      const browNames = ["browInnerUp", "browUp", "BrowsUp", "browRaise"];

      model.traverse((child) => {
        if (child.isBone) {
          if (!chestBone && /chest|spine2|upperchest/i.test(child.name)) chestBone = child;
          if (!shoulderL && /shoulder.*(L|Left)/i.test(child.name)) shoulderL = child;
          if (!shoulderR && /shoulder.*(R|Right)/i.test(child.name)) shoulderR = child;
        }

        if (child.isMesh && child.morphTargetDictionary) {
          const dict = child.morphTargetDictionary;

          for (let name of mouthNames) {
            if (dict[name] !== undefined) {
              mouthParts.push({ mesh: child, index: dict[name] });
              break;
            }
          }
          for (let name of eyeNames) {
            if (dict[name] !== undefined) {
              eyeParts.push({ mesh: child, index: dict[name] });
            }
          }
          for (let name of smileNames) {
            if (dict[name] !== undefined) {
              smileParts.push({ mesh: child, index: dict[name] });
              break;
            }
          }
          for (let name of browNames) {
            if (dict[name] !== undefined) {
              browParts.push({ mesh: child, index: dict[name] });
              break;
            }
          }
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const faceHeight = box.max.y - size.y * 0.12;
      camera.position.set(center.x, faceHeight, center.z + 0.55);
      camera.lookAt(center.x, faceHeight, center.z);
    },
    undefined,
    (err) => {
      console.error("Error loading GLB:", err);
      if (avatarLoading) avatarLoading.textContent = "Error loading avatar";
      setStatus("Avatar load error");
    }
  );
}

// =======================
//  ANIMATION LOOP
// =======================
function startAnimationLoop() {
  if (animationLoopStarted) return;
  animationLoopStarted = true;
  animate();
}

function animate() {
  requestAnimationFrame(animate);

  const now = Date.now();
  const t = now * 0.001;

  if (model) {
    let blinkVal = 0;
    if (now > nextBlinkTime) {
      if (now < nextBlinkTime + 130) {
        blinkVal = 1;
      } else {
        nextBlinkTime = now + 2000 + Math.random() * 2000;
      }
    }
    eyeParts.forEach((p) => {
      p.mesh.morphTargetInfluences[p.index] = blinkVal;
    });

    updateHeadAndBody(now, t);
    updateFace(now, t);
  }

  renderer.render(scene, camera);
}

function updateHeadAndBody(now, t) {
  const breathe = Math.sin(t * 1.4) * 0.015;
  model.position.y = breathe;

  if (chestBone) {
    chestBone.rotation.x = Math.sin(t * 1.5) * 0.04;
  }

  if (shoulderL && shoulderR) {
    shoulderL.rotation.z = Math.sin(t * 0.8) * 0.03;
    shoulderR.rotation.z = -Math.sin(t * 0.8) * 0.03;
  }

  if (!isTalking) {
    const sinceLook = now - lastPointerLookTime;

    if (pointerInAvatar && sinceLook < 2500) {
      headTarget.y = THREE.MathUtils.clamp(pointerNorm.x * 0.35, -0.35, 0.35);
      headTarget.x = THREE.MathUtils.clamp(-pointerNorm.y * 0.2, -0.2, 0.2);
    } else {
      if (now > nextIdleHeadTurn) {
        headTarget.y = (Math.random() - 0.5) * 0.35;
        headTarget.x = (Math.random() - 0.5) * 0.12;
        nextIdleHeadTurn = now + 2000 + Math.random() * 4000;
      }
    }
  } else {
    headTarget.y = Math.sin(t * 1.2) * 0.08;
    headTarget.x = Math.sin(t * 1.6) * 0.03;
  }

  model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, headTarget.y, 0.08);
  model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, headTarget.x, 0.08);
}

function updateFace(now, t) {
  if (isTalking) {
    const elapsed = (now - speakStartTime) / 1000;
    const progress = THREE.MathUtils.clamp(elapsed / speakDuration, 0, 1);

    const noise =
      0.6 * (Math.sin(t * 8.2) * 0.5 + 0.5) +
      0.4 * (Math.sin(t * 11.7 + 1.5) * 0.5 + 0.5);

    const base = progress < 0.07 || progress > 0.97 ? 0.1 : 0.4;
    const targetMouth = base + 0.55 * noise;
    mouthValue = THREE.MathUtils.lerp(mouthValue, targetMouth, 0.35);

    const targetSmile = 0.5;
    const targetBrow = 0.25;
    smileValue = THREE.MathUtils.lerp(smileValue, targetSmile, 0.15);
    browValue = THREE.MathUtils.lerp(browValue, targetBrow, 0.18);
  } else {
    mouthValue = THREE.MathUtils.lerp(mouthValue, 0, 0.18);
    const idleSmile = 0.25;
    const idleBrow = 0.02;
    smileValue = THREE.MathUtils.lerp(smileValue, idleSmile, 0.05);
    browValue = THREE.MathUtils.lerp(browValue, idleBrow, 0.05);
  }

  mouthParts.forEach((p) => {
    p.mesh.morphTargetInfluences[p.index] = mouthValue;
  });

  smileParts.forEach((p) => {
    p.mesh.morphTargetInfluences[p.index] = smileValue;
  });

  browParts.forEach((p) => {
    p.mesh.morphTargetInfluences[p.index] = browValue;
  });
}

// =======================
//  AVATAR PICKER UI
// =======================
function setupAvatarPicker() {
  if (!avatarSelect) return;

  avatarSelect.addEventListener("change", (e) => {
    loadAvatar(e.target.value);
  });
}

// =======================
//  OPENAI + BUTTON LOGIC
// =======================
function setupButtons() {
  if (!btnSpeak || !btnPaths) return;

  btnSpeak.addEventListener("click", () => handleInteraction("speak"));
  btnPaths.addEventListener("click", () => handleInteraction("paths"));

  if (stopSpeechBtn) {
    stopSpeechBtn.addEventListener("click", stopSpeaking);
  }
}

async function handleInteraction(kind) {
  try {
    setButtonsDisabled(true);
    setStatus("Waiting for your input...");

    const userInput = await openInputModal(kind);
    if (!userInput || !userInput.trim()) {
      setStatus("Ready");
      return;
    }

    const systemPrompt = buildSystemPrompt(kind);
    setStatus("Thinking...");
    const reply = await callOpenAI(systemPrompt, userInput.trim());

    const you = formatTextForOutput("You", userInput.trim());
    const bot = formatTextForOutput("EDGE Guide", reply);
    output.innerHTML = `${you}<br><br>${bot}`;

    setStatus("Speaking...");
    await speakText(reply);
    setStatus("Ready");
  } catch (err) {
    console.error(err);
    if (output) {
      output.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message || "Something went wrong with the AI call.")}`;
    }
    setStatus("Error");
  } finally {
    setButtonsDisabled(false);
    setStopButton(false);
  }
}

function buildSystemPrompt(kind) {
  if (kind === "paths") {
    return "You are an indoor navigation assistant at EDGE. The user is starting from the main lobby. Reply only in English with short, step-by-step walking directions within the building. Max 5 steps.";
  }
  return "You are a friendly AI guide in a technology training center called EDGE. Reply only in English. Keep answers concise and conversational.";
}

function setButtonsDisabled(disabled) {
  if (btnSpeak) btnSpeak.disabled = disabled;
  if (btnPaths) btnPaths.disabled = disabled;
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text || "";
}

// --- OpenAI Chat API helper ---
async function callOpenAI(systemPrompt, userMessage) {
  if (!OPENAI_API_KEY || !OPENAI_API_KEY.startsWith("sk-")) {
    if (!promptForApiKey()) {
      throw new Error("OpenAI API key is required. Please refresh and enter a valid key.");
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.5,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// =======================
//  INPUT MODAL + MIC
// =======================
function setupInputModal() {
  if (!inputModal) return;

  inputModal.addEventListener("click", (e) => {
    if (e.target === inputModal) closeInputModal(null);
  });

  if (inputClose) {
    inputClose.addEventListener("click", () => closeInputModal(null));
  }

  if (inputSubmit) {
    inputSubmit.addEventListener("click", submitInput);
  }

  inputModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchInputMode(btn.dataset.mode));
  });

  if (!micSupported) {
    updateMicStatus("Microphone capture is not supported in this browser. Use text input instead.");
  }

  switchInputMode(activeInputMode);
}

function openInputModal(kind) {
  return new Promise((resolve) => {
    resolveInput = resolve;
    currentTranscript = "";
    if (inputTextarea) inputTextarea.value = "";

    const copy = getInputCopy(kind);
    if (inputTitle) inputTitle.textContent = copy.title;
    if (inputSubtitle) inputSubtitle.textContent = copy.subtitle;
    if (inputTextarea) inputTextarea.placeholder = copy.placeholder;

    activeInputMode = micSupported ? "mic" : "text";
    switchInputMode(activeInputMode);
    updateMicStatus(micSupported ? "Listening..." : "Mic not available. Use text input.");

    if (inputModal) {
      inputModal.classList.add("show");
      inputModal.setAttribute("aria-hidden", "false");
    }
  });
}

function submitInput() {
  if (!resolveInput) return;

  const text = (inputTextarea?.value || "").trim();
  if (!text) {
    updateMicStatus("Say something or type your request first.");
    return;
  }

  closeInputModal(text);
}

function closeInputModal(result = null) {
  stopListening();

  if (inputModal) {
    inputModal.classList.remove("show");
    inputModal.setAttribute("aria-hidden", "true");
  }

  if (resolveInput) {
    const resolver = resolveInput;
    resolveInput = null;
    resolver(result);
  }
}

function switchInputMode(mode) {
  if (mode === "mic" && !micSupported) {
    activeInputMode = "text";
  } else {
    activeInputMode = mode;
  }

  inputModeButtons.forEach((btn) => {
    const isActive = btn.dataset.mode === activeInputMode;
    btn.classList.toggle("active", isActive);
  });

  if (activeInputMode === "mic" && micSupported) {
    startListening();
  } else {
    stopListening();
    updateMicStatus("Type your question, then send.");
    if (inputTextarea) inputTextarea.focus();
  }
}

function startListening() {
  if (!SpeechRecognition) {
    updateMicStatus("Mic is not supported in this browser.");
    return;
  }

  if (isRecording) return;
  stopListening();

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onstart = () => {
    isRecording = true;
    currentTranscript = "";
    updateMicStatus("Listening...");
    setStatus("Listening...");
  };

  recognition.onerror = (e) => {
    isRecording = false;
    updateMicStatus(`Mic error: ${e.error || "unknown"}. Try again or type instead.`);
    setStatus("Ready");
  };

  recognition.onend = () => {
    isRecording = false;
    if (!resolveInput) return;
    if (activeInputMode === "mic" && currentTranscript) {
      return;
    }
    updateMicStatus(currentTranscript ? "Captured speech. You can edit before sending." : "No speech detected. Try again or switch to text.");
    setStatus("Waiting for your input...");
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    currentTranscript = transcript.trim();
    if (inputTextarea) inputTextarea.value = currentTranscript;
    updateMicStatus("Listening...");

    const last = event.results[event.results.length - 1];
    if (last.isFinal && currentTranscript && activeInputMode === "mic") {
      setTimeout(() => closeInputModal(currentTranscript), 20);
    }
  };

  recognition.start();
}

function stopListening() {
  if (recognition && isRecording) {
    recognition.stop();
  }
  isRecording = false;
  recognition = null;
}

function getInputCopy(kind) {
  if (kind === "paths") {
    return {
      title: "Where should we go?",
      subtitle: "Ask for a room or area and I will give short, step-by-step directions.",
      placeholder: "Example: Take me to Lab 1 or Classroom B2."
    };
  }
  return {
    title: "Talk to the guide",
    subtitle: "Use the mic for hands-free mode or switch to text input.",
    placeholder: "Ask anything, or say Salam to begin."
  };
}

// =======================
//  SPEECH / LIP SYNC
// =======================
function speakText(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      isTalking = false;
      setStopButton(false);
      return resolve();
    }

    if (currentUtterance) {
      window.speechSynthesis.cancel();
      currentUtterance = null;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance = utterance;
    const voice = preferredVoice || null;
    const voiceLang = voice && voice.lang ? voice.lang : "en-US";
    utterance.voice = voice;
    utterance.lang = voiceLang;
    const isArabic = voiceLang.toLowerCase().startsWith("ar");
    utterance.rate = isArabic ? 0.9 : 0.95;
    utterance.pitch = isArabic ? 0.75 : 0.85;

    utterance.onstart = () => {
      isTalking = true;
      const len = text.length;
      speakDuration = Math.max(1.5, len / CHAR_PER_SECOND);
      speakStartTime = Date.now();
      setStopButton(true);
    };

    utterance.onend = () => {
      isTalking = false;
      currentUtterance = null;
      setStopButton(false);
      resolve();
    };

    utterance.onerror = () => {
      isTalking = false;
      currentUtterance = null;
      setStopButton(false);
      resolve();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

function stopSpeaking() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  isTalking = false;
  currentUtterance = null;
  setStopButton(false);
  setStatus("Stopped");
}

// =======================
//  HELPERS
// =======================
function updateMicStatus(text) {
  if (micStatus) micStatus.textContent = text;
}

function setStopButton(enabled) {
  if (stopSpeechBtn) stopSpeechBtn.disabled = !enabled;
}

function selectVoiceForAvatar(avatarId) {
  const avatar = AVATARS.find((a) => a.id === avatarId);
  if (!avatar || !availableVoices.length) return;

  const gender = avatar.gender || "neutral";
  const preferredByGender = {
    female: [
      "Microsoft Aria Online (Natural) - English (United States)",
      "Microsoft Jenny Online (Natural) - English (United States)",
      "Google UK English Female",
      "Google US English"
    ],
    male: [
      "Microsoft Guy Online (Natural) - English (United States)",
      "Microsoft Ryan Online (Natural) - English (United States)",
      "Microsoft Naayf Online (Natural) - Arabic (Saudi Arabia)",
      "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)",
      "Google UK English Male"
    ],
    neutral: []
  };

  const names = preferredByGender[gender] || preferredByGender.neutral;
  preferredVoice =
    availableVoices.find((v) => names.includes(v.name)) ||
    availableVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en")) ||
    availableVoices[0] ||
    null;
}

function disposeModel(obj) {
  obj.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry && child.geometry.dispose) {
        child.geometry.dispose();
      }
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m && m.dispose && m.dispose());
      } else if (mat && mat.dispose) {
        mat.dispose();
      }
    }
  });
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

function formatTextForOutput(label, text) {
  const safe = escapeHtml(text).replace(/\n/g, "<br>");
  return `<strong>${label}:</strong> ${safe}`;
}

// =======================
//  VOICE PICKER
// =======================
function initVoiceSelection() {
  const pickVoice = () => {
    availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!availableVoices.length) return;
    selectVoiceForAvatar(currentAvatarId);
  };

  pickVoice();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
}
