import type { Locale } from '../types/domain';

export interface TranslationDictionary {
  brandName: string;
  brandCompany: string;
  nav: {
    dashboard: string;
    projects: string;
    workspaces: string;
    architecture: string;
    settings: string;
    signOut: string;
  };
  topBar: {
    newProject: string;
    backToProjects: string;
    lightMode: string;
    darkMode: string;
    languageLabel: string;
  };
  auth: {
    title: string;
    subtitle: string;
    featureLine1: string;
    featureLine2: string;
    featureLine3: string;
    googleCta: string;
    dividerOr: string;
    emailLabel: string;
    passwordLabel: string;
    nameLabel: string;
    signInEmail: string;
    createAccount: string;
    resetPassword: string;
    switchToRegister: string;
    switchToLogin: string;
    verifyEmailNotice: string;
    resendVerification: string;
    verificationSent: string;
    resetSent: string;
    emailProviderHelp: string;
    enterpriseProvidersNote: string;
    signingIn: string;
  };
  dashboard: {
    heading: string;
    subheading: string;
    totalProjects: string;
    trainedModels: string;
    generatedApps: string;
    storageUsed: string;
    cloudCredits: string;
    recentTrainingTitle: string;
    recentTrainingEmpty: string;
    recentTrainingEmptyDesc: string;
    projectsTitle: string;
    projectsEmpty: string;
    projectsEmptyDesc: string;
    createFirstProject: string;
    activityTitle: string;
    activityEmpty: string;
    viewAllProjects: string;
    searchPlaceholder: string;
    filterAll: string;
  };
  tasks: {
    image_classification: string;
    image_classification_desc: string;
    object_detection: string;
    object_detection_desc: string;
    image_segmentation: string;
    anomaly_detection: string;
    pose_estimation: string;
    ocr_text: string;
    video_recognition: string;
    custom: string;
    availableV1: string;
    comingSoon: string;
  };
  projectModal: {
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    descLabel: string;
    descPlaceholder: string;
    workspaceLabel: string;
    taskLabel: string;
    futureTasksLabel: string;
    modeLabel: string;
    beginnerMode: string;
    beginnerDesc: string;
    advancedMode: string;
    advancedDesc: string;
    storageLabel: string;
    localStorage: string;
    localStorageDesc: string;
    cloudStorage: string;
    cloudStorageDesc: string;
    cloudConsentLabel: string;
    cancel: string;
    create: string;
    creating: string;
  };
  workspaceView: {
    heading: string;
    subheading: string;
    createWorkspace: string;
    workspaceName: string;
    workspaceType: string;
    personal: string;
    team: string;
    storageMode: string;
    regionLabel: string;
    rolesTitle: string;
    rolesSubtitle: string;
    roleOwner: string;
    roleAdmin: string;
    roleTrainer: string;
    roleAnnotator: string;
    roleViewer: string;
    createAction: string;
  };
  projectWorkspace: {
    tabs: {
      overview: string;
      dataset: string;
      annotation: string;
      training: string;
      evaluation: string;
      model_hub: string;
      app_builder: string;
      deployment: string;
      settings: string;
    };
    togglePanels: string;
    pipelineReadiness: string;
    phase1Title: string;
    phase1Desc: string;
    phase2Title: string;
    phase2Desc: string;
    phase3Title: string;
    phase3Desc: string;
    phase4Title: string;
    phase4Desc: string;
    phase5Title: string;
    phase5Desc: string;
    phase6Title: string;
    phase6Desc: string;
    engineStatusTitle: string;
    engineProbeBtn: string;
    engineProbing: string;
    engineNotConfigured: string;
    engineOffline: string;
    engineOnline: string;
    noFakeTrainingRule: string;
    saveSettings: string;
    saving: string;
    savedNotice: string;
    dangerZone: string;
    deleteProject: string;
    deleteConfirm: string;
    confirmDeleteBtn: string;
  };
  datasetStudio: {
    createTitle: string;
    createSubtitle: string;
    datasetName: string;
    datasetNamePlaceholder: string;
    datasetDesc: string;
    initialClasses: string;
    initialClassesHint: string;
    createBtn: string;
    creatingBtn: string;
    activeDataset: string;
    newDatasetBtn: string;
    subTabs: {
      ingest: string;
      classesSplits: string;
      quality: string;
      augmentation: string;
    };
    uploadImagesTitle: string;
    uploadImagesDesc: string;
    selectImagesBtn: string;
    uploadVideoTitle: string;
    uploadVideoDesc: string;
    intervalLabel: string;
    maxFramesLabel: string;
    extractFramesBtn: string;
    cameraTitle: string;
    cameraDesc: string;
    startCameraBtn: string;
    stopCameraBtn: string;
    switchCameraBtn: string;
    captureSingleBtn: string;
    startBurstBtn: string;
    stopBurstBtn: string;
    importTitle: string;
    importDesc: string;
    importYoloBtn: string;
    importCocoBtn: string;
    exportYoloBtn: string;
    exportCocoBtn: string;
    classesTitle: string;
    addClassPlaceholder: string;
    addClassBtn: string;
    splitsTitle: string;
    trainSplit: string;
    valSplit: string;
    testSplit: string;
    applySplitsBtn: string;
    splitSumError: string;
    qualityTitle: string;
    totalImages: string;
    annotatedImages: string;
    approvedImages: string;
    imbalanceRatio: string;
    duplicatesLabel: string;
    missingAnnotationsLabel: string;
    invalidAnnotationsLabel: string;
    lowResLabel: string;
    blurryLabel: string;
    noIssues: string;
    removeDuplicatesBtn: string;
    classDistribution: string;
    augmentationTitle: string;
    augmentationLeakageRule: string;
    rotateLabel: string;
    flipHLabel: string;
    flipVLabel: string;
    brightnessLabel: string;
    contrastLabel: string;
    noiseLabel: string;
    blurLabel: string;
    resizeLabel: string;
    saveAugBtn: string;
    previewLabel: string;
    markReadyBtn: string;
    readyBadge: string;
    galleryTitle: string;
    openInAnnotator: string;
    deleteImage: string;
  };
  annotationStudio: {
    noDatasetTitle: string;
    noDatasetDesc: string;
    noImagesTitle: string;
    noImagesDesc: string;
    filterAll: string;
    filterUnlabeled: string;
    filterApproved: string;
    prevBtn: string;
    nextBtn: string;
    zoomIn: string;
    zoomOut: string;
    resetView: string;
    approveBtn: string;
    approvedLabel: string;
    activeClassLabel: string;
    classificationHint: string;
    detectionHint: string;
    boxesTitle: string;
    deleteBox: string;
    shortcutsTitle: string;
    shortcutsDesc: string;
    splitLabel: string;
    resolutionLabel: string;
    blurScoreLabel: string;
  };
  trainingStudio: {
    heading: string;
    subheading: string;
    datasetGateTitle: string;
    datasetGateEmpty: string;
    datasetGateNeedAnnotated: string;
    datasetGateReady: string;
    datasetLabel: string;
    architectureLabel: string;
    backendEngineLabel: string;
    browserEngineBadge: string;
    pythonEngineBadge: string;
    pythonOfflineHint: string;
    modeBeginnerDesc: string;
    modeAdvancedDesc: string;
    epochsLabel: string;
    batchSizeLabel: string;
    learningRateLabel: string;
    optimizerLabel: string;
    inputSizeLabel: string;
    confThresholdLabel: string;
    iouThresholdLabel: string;
    patienceLabel: string;
    saveCheckpointsLabel: string;
    startTrainingBtn: string;
    pauseBtn: string;
    resumeBtn: string;
    cancelBtn: string;
    liveProgressTitle: string;
    lossChartTitle: string;
    metricChartTitle: string;
    logsTitle: string;
    epochLabel: string;
    bestEpochLabel: string;
    hardwareLabel: string;
    trainedModelsTitle: string;
    trainedModelsEmpty: string;
    accuracyLabel: string;
    precisionLabel: string;
    recallLabel: string;
    f1Label: string;
    map50Label: string;
    latencyLabel: string;
    modelSizeLabel: string;
    paramsLabel: string;
    confusionTitle: string;
    perClassTitle: string;
    exportWeightsBtn: string;
    setActiveBtn: string;
    activeModelLabel: string;
    deleteModelBtn: string;
    quickTestTitle: string;
    quickTestDesc: string;
    uploadTestImageBtn: string;
    recentRunsTitle: string;
    statusQueued: string;
    statusRunning: string;
    statusPaused: string;
    statusCompleted: string;
    statusCancelled: string;
    statusFailed: string;
  };
  evaluationStudio: {
    heading: string;
    subheading: string;
    emptyTitle: string;
    emptyDesc: string;
    goToTrainingBtn: string;
    batchRunnerTitle: string;
    selectModelLabel: string;
    selectSplitLabel: string;
    splitTest: string;
    splitVal: string;
    splitAll: string;
    confThresholdLabel: string;
    iouThresholdLabel: string;
    runEvalBtn: string;
    runningEvalBtn: string;
    saveSnapshotBtn: string;
    savingSnapshotBtn: string;
    snapshotSavedNotice: string;
    noLocalWeightsError: string;
    evaluatedCountLabel: string;
    avgLatencyLabel: string;
    p95LatencyLabel: string;
    throughputLabel: string;
    confusionHint: string;
    clearCellFilter: string;
    sampleInspectorTitle: string;
    filterAll: string;
    filterErrors: string;
    filterCorrect: string;
    groundTruthLabel: string;
    predictedLabel: string;
    comparisonTitle: string;
    comparisonDesc: string;
    liveLabTitle: string;
    liveLabDesc: string;
    uploadImageBtn: string;
    startCameraBtn: string;
    captureAndPredictBtn: string;
    stopCameraBtn: string;
    savedReportsTitle: string;
    savedReportsEmpty: string;
    deleteReportBtn: string;
    bestHighlightLabel: string;
  };
  modelHub: {
    heading: string;
    subheading: string;
    emptyTitle: string;
    emptyDesc: string;
    searchPlaceholder: string;
    filterAll: string;
    filterActive: string;
    filterOnDevice: string;
    versionPrefix: string;
    weightsReady: string;
    weightsMissing: string;
    setActiveBtn: string;
    activeTargetLabel: string;
    renameBtn: string;
    saveNameBtn: string;
    cancelRenameBtn: string;
    compatibilityTitle: string;
    desktopReady: string;
    mobileReady: string;
    tabletReady: string;
    offlineReady: string;
    compatibleYes: string;
    compatibleNo: string;
    exportPanelTitle: string;
    exportTfjsBtn: string;
    exportBundleBtn: string;
    exportCardJsonBtn: string;
    exportCardCsvBtn: string;
    exportTsBtn: string;
    exportPyBtn: string;
    continueAppBuilderBtn: string;
    deleteModelBtn: string;
    confirmDeleteBtn: string;
  };
  appBuilder: {
    heading: string;
    subheading: string;
    emptyTitle: string;
    emptyDesc: string;
    goTrainingBtn: string;
    savedAppsLabel: string;
    newAppBtn: string;
    saveAppBtn: string;
    savingBtn: string;
    updateAppBtn: string;
    deleteAppBtn: string;
    confirmDeleteBtn: string;
    savedNotice: string;
    configIdentityTitle: string;
    tierLabel: string;
    tierBasic: string;
    tierBasicDesc: string;
    tierCustom: string;
    tierCustomDesc: string;
    tierProfessional: string;
    tierProfessionalDesc: string;
    appNameLabel: string;
    shortNameLabel: string;
    customHeaderLabel: string;
    appDescLabel: string;
    themeColorLabel: string;
    surfaceModeLabel: string;
    surfaceLight: string;
    surfaceDark: string;
    modelRuntimeTitle: string;
    targetModelLabel: string;
    runtimeTargetLabel: string;
    runtimeOnDevice: string;
    runtimeHybridCloud: string;
    weightsVerified: string;
    weightsNotLocal: string;
    onDeviceBlockedHint: string;
    controlsAlertTitle: string;
    inputSourcesLabel: string;
    sourceCamera: string;
    sourceUpload: string;
    sourceVideo: string;
    confThresholdLabel: string;
    iouThresholdLabel: string;
    showConfidenceLabel: string;
    showLatencyLabel: string;
    showHistoryLabel: string;
    allowCsvExportLabel: string;
    alertRuleLabel: string;
    alertClassLabel: string;
    alertMinConfLabel: string;
    previewTitle: string;
    viewportDesktop: string;
    viewportTablet: string;
    viewportMobile: string;
    launchStandaloneBtn: string;
    exitStandaloneBtn: string;
    uploadTestBtn: string;
    cameraStartBtn: string;
    cameraStopBtn: string;
    videoScanBtn: string;
    predictionOutputTitle: string;
    latencyReadout: string;
    alertTriggeredLabel: string;
    historyLogTitle: string;
    exportCsvBtn: string;
    clearHistoryBtn: string;
    noPredictionYet: string;
    pwaExportTitle: string;
    readinessTitle: string;
    checkWeights: string;
    checkManifest: string;
    checkOfflineRuntime: string;
    checkServiceWorker: string;
    downloadStandaloneBtn: string;
    downloadManifestBtn: string;
    downloadSwBtn: string;
    downloadIconBtn: string;
    downloadReadmeBtn: string;
    downloadConfigBtn: string;
  };
  pwa: {
    installAppBtn: string;
    installIosBtn: string;
    installGuideBtn: string;
    guideTitle: string;
    iosInstructions: string;
    desktopInstructions: string;
    closeGuide: string;
    offlineNotice: string;
  };
  architectureView: {
    heading: string;
    subheading: string;
    backendHealthTitle: string;
    refreshHealth: string;
    aiEngineProbeTitle: string;
    cloudAdapterTitle: string;
    roadmapTitle: string;
    storageAdapter: string;
    computeAdapter: string;
    statusOk: string;
    statusOffline: string;
  };
  settingsView: {
    heading: string;
    subheading: string;
    profileSection: string;
    displayNameLabel: string;
    emailLabel: string;
    saveProfile: string;
    preferencesSection: string;
    securitySection: string;
    twoFactorLabel: string;
    twoFactorDesc: string;
    sessionSection: string;
    verifySessionBtn: string;
    billingSection: string;
    currentPlan: string;
    planFree: string;
    creditsBalance: string;
    storageQuota: string;
  };
  statuses: {
    draft: string;
    dataset_ready: string;
    training: string;
    trained: string;
    deployed: string;
  };
  actions: {
    project_created: string;
    project_updated: string;
    project_deleted: string;
    workspace_created: string;
    settings_updated: string;
    dataset_created: string;
    dataset_updated: string;
    dataset_exported: string;
    training_started: string;
    training_completed: string;
    training_cancelled: string;
    model_evaluated: string;
    model_exported: string;
    model_activated: string;
    model_deleted: string;
    app_created: string;
    app_updated: string;
    app_exported: string;
    app_deleted: string;
  };
  common: {
    loading: string;
    errorTitle: string;
    retry: string;
    close: string;
    datasets: string;
    models: string;
    apps: string;
    openWorkspace: string;
    noDescription: string;
  };
}

export const translations: Record<Locale, TranslationDictionary> = {
  en: {
    brandName: 'MK AI',
    brandCompany: 'MK Tech',
    nav: {
      dashboard: 'Dashboard',
      projects: 'Projects',
      workspaces: 'Workspaces',
      architecture: 'System & Roadmap',
      settings: 'Account & Security',
      signOut: 'Sign Out',
    },
    topBar: {
      newProject: 'New Project',
      backToProjects: 'All Projects',
      lightMode: 'Light',
      darkMode: 'Dark',
      languageLabel: 'العربية',
    },
    auth: {
      title: 'MK AI Vision Platform',
      subtitle:
        'Train real Computer Vision models and turn them into installable cross-platform applications.',
      featureLine1: 'Real PyTorch and Ultralytics YOLO training pipelines — zero simulated metrics.',
      featureLine2: 'Private by default with Local-First storage and explicit Cloud Sync consent.',
      featureLine3: 'Export standalone installable PWAs for desktop, Android, and iOS.',
      googleCta: 'Continue with Google',
      dividerOr: 'or use email credentials',
      emailLabel: 'Work Email',
      passwordLabel: 'Password',
      nameLabel: 'Full Name',
      signInEmail: 'Sign In',
      createAccount: 'Create Account',
      resetPassword: 'Forgot password?',
      switchToRegister: 'Create an email account',
      switchToLogin: 'Already have an account? Sign in',
      verifyEmailNotice:
        'Please verify your email address before creating projects or writing workspace data.',
      resendVerification: 'Resend Verification Email',
      verificationSent: 'Verification email sent. Check your inbox and reload once verified.',
      resetSent: 'Password reset link sent to your email address.',
      emailProviderHelp:
        'Email/Password sign-in is disabled in the Firebase Console for this project. Use Google Sign-In above, or enable Email/Password under Firebase Console > Authentication > Sign-in method.',
      enterpriseProvidersNote:
        'Microsoft & Apple SSO and hardware 2FA enrollment can be configured in the Firebase Authentication provider console.',
      signingIn: 'Signing in...',
    },
    dashboard: {
      heading: 'Workspace Overview',
      subheading: 'Manage Computer Vision projects, storage quotas, and verified training infrastructure.',
      totalProjects: 'Total Projects',
      trainedModels: 'Trained Models',
      generatedApps: 'Generated Apps',
      storageUsed: 'Storage Used',
      cloudCredits: 'Cloud Credits',
      recentTrainingTitle: 'Recent Training Jobs',
      recentTrainingEmpty: 'No training jobs executed yet',
      recentTrainingEmptyDesc:
        'Real training metrics appear here once the Python AI Training Engine (Phase 3) executes a job on your prepared dataset.',
      projectsTitle: 'Computer Vision Projects',
      projectsEmpty: 'No projects created yet',
      projectsEmptyDesc:
        'Create your first Computer Vision project to configure task type, storage privacy, and workspace pipelines.',
      createFirstProject: 'Create First Project',
      activityTitle: 'Recent Activity',
      activityEmpty: 'No recorded workspace activity yet.',
      viewAllProjects: 'Open Workspace',
      searchPlaceholder: 'Search projects...',
      filterAll: 'All Tasks',
    },
    tasks: {
      image_classification: 'Image Classification',
      image_classification_desc: 'Categorize full images into custom classes using MobileNetV3 or EfficientNet.',
      object_detection: 'Object Detection',
      object_detection_desc: 'Locate and label bounding boxes with YOLO or RT-DETR architectures.',
      image_segmentation: 'Image Segmentation',
      anomaly_detection: 'Anomaly Detection',
      pose_estimation: 'Pose Estimation',
      ocr_text: 'OCR & Text Recognition',
      video_recognition: 'Video Recognition',
      custom: 'Custom AI Tasks',
      availableV1: 'V1.0 Ready',
      comingSoon: 'Coming Soon',
    },
    projectModal: {
      title: 'Create AI Vision Project',
      subtitle: 'Configure your task type, training workflow mode, and private storage boundary.',
      nameLabel: 'Project Name',
      namePlaceholder: 'e.g. PCB Defect Inspection',
      descLabel: 'Description',
      descPlaceholder: 'Describe the visual inspection target and deployment environment...',
      workspaceLabel: 'Workspace',
      taskLabel: 'AI Task (V1.0 Active)',
      futureTasksLabel: 'Scheduled Future Tasks',
      modeLabel: 'Training Experience Mode',
      beginnerMode: 'Beginner Mode',
      beginnerDesc: 'Automatic architecture & hyperparameter selection.',
      advancedMode: 'Advanced Mode',
      advancedDesc: 'Full control over epochs, batch size, optimizer, and thresholds.',
      storageLabel: 'Storage & Privacy Boundary',
      localStorage: 'Local First (Private)',
      localStorageDesc: 'Keep datasets on device / local workspace unless explicitly synced.',
      cloudStorage: 'Cloud Sync',
      cloudStorageDesc: 'Store datasets and checkpoints via Multi-Cloud Object Storage.',
      cloudConsentLabel:
        'I explicitly consent to uploading project datasets and artifacts to configured cloud storage.',
      cancel: 'Cancel',
      create: 'Create Project',
      creating: 'Creating...',
    },
    workspaceView: {
      heading: 'Workspaces & Access Governance',
      subheading: 'Organize isolated personal projects and prepare team RBAC boundaries.',
      createWorkspace: 'New Workspace',
      workspaceName: 'Workspace Name',
      workspaceType: 'Workspace Type',
      personal: 'Personal',
      team: 'Team (RBAC Ready)',
      storageMode: 'Default Storage',
      regionLabel: 'Region / Endpoint',
      rolesTitle: 'Team RBAC Roles Architecture',
      rolesSubtitle:
        'Database rules and subcollection membership schemas are provisioned for multi-user collaboration.',
      roleOwner: 'Owner — Full workspace, billing, and deletion authority',
      roleAdmin: 'Admin — Manage members, projects, and cloud connectors',
      roleTrainer: 'Trainer — Configure and execute AI training jobs',
      roleAnnotator: 'Annotator — Upload images and draw dataset bounding boxes',
      roleViewer: 'Viewer — Read-only access to evaluation metrics and apps',
      createAction: 'Create Workspace',
    },
    projectWorkspace: {
      tabs: {
        overview: 'Overview',
        dataset: 'Dataset',
        annotation: 'Annotation',
        training: 'Training',
        evaluation: 'Evaluation',
        model_hub: 'Model Hub',
        app_builder: 'App Builder',
        deployment: 'Deployment',
        settings: 'Settings',
      },
      togglePanels: 'Toggle Side Inspector',
      pipelineReadiness: 'Pipeline Phase Readiness',
      phase1Title: 'Phase 1 — Project Foundation',
      phase1Desc: 'Project metadata, workspace ownership, storage consent, and audit logging are active.',
      phase2Title: 'Phase 2 — MK Dataset Studio',
      phase2Desc:
        'Image/video upload, camera capture, bounding box annotation, quality checks, and augmentation rules are active.',
      phase3Title: 'Phase 3 — Real AI Training Engine',
      phase3Desc:
        'Real TensorFlow.js in-browser CNN/YOLO-grid training + Python FastAPI PyTorch/YOLO worker, live loss charts, checkpoints, and metrics are active.',
      phase4Title: 'Phase 4 — Model Hub & Evaluation',
      phase4Desc:
        'Batch test-split evaluation, interactive confusion matrix, side-by-side model comparison, live camera inference, and versioned Model Hub exports are active.',
      phase5Title: 'Phase 5 — MK App Builder',
      phase5Desc:
        'Basic/Custom/Professional Vision App Builder, real in-preview TF.js runner, standalone HTML + offline PWA manifest/SW packager are active.',
      phase6Title: 'Phase 6 — Deployment & Hybrid Storage',
      phase6Desc:
        'MK AI Hosting, version rollback, external export, and Google Drive/OneDrive/Dropbox connectors activate in Phase 6.',
      engineStatusTitle: 'Python AI Engine Connectivity',
      engineProbeBtn: 'Probe Python Engine',
      engineProbing: 'Probing...',
      engineNotConfigured: 'Not Configured',
      engineOffline: 'Offline / Unreachable',
      engineOnline: 'Online & Ready',
      noFakeTrainingRule:
        'No simulated epochs or placeholder metrics are shown. Connect the Python FastAPI AI Engine (`ai_engine/main.py`) to inspect real CPU/CUDA hardware.',
      saveSettings: 'Save Changes',
      saving: 'Saving...',
      savedNotice: 'Project settings updated.',
      dangerZone: 'Danger Zone',
      deleteProject: 'Delete Project',
      deleteConfirm: 'Permanently delete this project and its configuration? This cannot be undone.',
      confirmDeleteBtn: 'Confirm Delete',
    },
    datasetStudio: {
      createTitle: 'Create Dataset',
      createSubtitle: 'Create a versioned dataset container for this project. Raw media is stored locally in IndexedDB.',
      datasetName: 'Dataset Name',
      datasetNamePlaceholder: 'e.g. Production Line v1',
      datasetDesc: 'Description',
      initialClasses: 'Initial Classes (comma-separated)',
      initialClassesHint: 'e.g. pass, scratch, missing_pin',
      createBtn: 'Create Dataset',
      creatingBtn: 'Creating...',
      activeDataset: 'Active Dataset',
      newDatasetBtn: 'New Dataset',
      subTabs: {
        ingest: 'Collect & Import',
        classesSplits: 'Classes & Splits',
        quality: 'Quality Audit',
        augmentation: 'Augmentation',
      },
      uploadImagesTitle: 'Upload Images',
      uploadImagesDesc: 'Select JPG, PNG, or WebP images. SHA-256 hashes and sharpness scores are computed locally.',
      selectImagesBtn: 'Select Images',
      uploadVideoTitle: 'Extract Video Frames',
      uploadVideoDesc: 'Automatically extract JPEG frames from MP4/WebM video clips at fixed intervals.',
      intervalLabel: 'Interval (sec)',
      maxFramesLabel: 'Max Frames',
      extractFramesBtn: 'Select Video & Extract',
      cameraTitle: 'Live Camera & Continuous Capture',
      cameraDesc: 'Capture single frames or continuous bursts directly from webcam or mobile camera.',
      startCameraBtn: 'Start Camera',
      stopCameraBtn: 'Stop Camera',
      switchCameraBtn: 'Switch Lens',
      captureSingleBtn: 'Capture Frame',
      startBurstBtn: 'Start Continuous Capture',
      stopBurstBtn: 'Stop Capture',
      importTitle: 'Import & Export Datasets',
      importDesc: 'Import YOLO (.txt + images) or COCO (.json + images), or export this dataset preserving splits.',
      importYoloBtn: 'Import YOLO Files',
      importCocoBtn: 'Import COCO JSON + Images',
      exportYoloBtn: 'Export YOLO Bundle',
      exportCocoBtn: 'Export COCO JSON',
      classesTitle: 'Class Definitions',
      addClassPlaceholder: 'New class name',
      addClassBtn: 'Add Class',
      splitsTitle: 'Train / Validation / Test Splitting',
      trainSplit: 'Train %',
      valSplit: 'Validation %',
      testSplit: 'Test %',
      applySplitsBtn: 'Save & Re-Assign Splits',
      splitSumError: 'Split percentages must sum to exactly 100%.',
      qualityTitle: 'Dataset Quality Audit',
      totalImages: 'Total Images',
      annotatedImages: 'Annotated',
      approvedImages: 'Reviewed & Approved',
      imbalanceRatio: 'Class Imbalance Ratio',
      duplicatesLabel: 'Duplicate Image Groups (SHA-256)',
      missingAnnotationsLabel: 'Missing Annotations',
      invalidAnnotationsLabel: 'Invalid / Out-of-Bounds Annotations',
      lowResLabel: 'Low Resolution (< 224px)',
      blurryLabel: 'Potential Blur (Laplacian < 45)',
      noIssues: 'No issues detected in this check.',
      removeDuplicatesBtn: 'Remove Duplicate Copies',
      classDistribution: 'Class Distribution',
      augmentationTitle: 'Training Augmentation Pipeline',
      augmentationLeakageRule:
        'Data Leakage Protection: Augmentations apply strictly to the Train split. Validation and Test images remain unmodified.',
      rotateLabel: 'Max Rotation (deg)',
      flipHLabel: 'Horizontal Flip',
      flipVLabel: 'Vertical Flip',
      brightnessLabel: 'Brightness Shift (%)',
      contrastLabel: 'Contrast Shift (%)',
      noiseLabel: 'Gaussian Noise',
      blurLabel: 'Blur Radius (px)',
      resizeLabel: 'Target Input Size',
      saveAugBtn: 'Save Augmentation Config',
      previewLabel: 'Live Canvas Preview (Sample Image)',
      markReadyBtn: 'Approve & Mark Dataset Ready',
      readyBadge: 'Dataset Ready for Training',
      galleryTitle: 'Dataset Media Library',
      openInAnnotator: 'Annotate',
      deleteImage: 'Remove',
    },
    annotationStudio: {
      noDatasetTitle: 'No Dataset Selected',
      noDatasetDesc: 'Create a dataset in the Dataset tab first before annotating images.',
      noImagesTitle: 'No Images in Dataset',
      noImagesDesc: 'Upload images, extract video frames, or capture from your camera in the Dataset tab.',
      filterAll: 'All',
      filterUnlabeled: 'Unlabeled',
      filterApproved: 'Approved',
      prevBtn: 'Previous',
      nextBtn: 'Next',
      zoomIn: 'Zoom In',
      zoomOut: 'Zoom Out',
      resetView: 'Reset View',
      approveBtn: 'Approve Sample',
      approvedLabel: 'Approved',
      activeClassLabel: 'Active Class',
      classificationHint: 'Select a class below or press keys 1–9 to label this image.',
      detectionHint: 'Click and drag on the image to draw a bounding box for the active class.',
      boxesTitle: 'Bounding Boxes',
      deleteBox: 'Delete Box',
      shortcutsTitle: 'Keyboard Shortcuts',
      shortcutsDesc: 'A/D or Left/Right: Navigate · 1-9: Assign Class · Delete: Remove Box · Space: Approve · 0: Reset Zoom',
      splitLabel: 'Split',
      resolutionLabel: 'Resolution',
      blurScoreLabel: 'Sharpness',
    },
    trainingStudio: {
      heading: 'MK Real AI Training Studio',
      subheading: 'Train real Computer Vision neural networks directly in your browser (TensorFlow.js) or dispatch to a connected Python PyTorch/YOLO worker.',
      datasetGateTitle: 'Training Dataset Readiness',
      datasetGateEmpty: 'Create and populate a dataset in the Dataset tab before training.',
      datasetGateNeedAnnotated: 'At least 2 annotated images in the Train split are required for real gradient training.',
      datasetGateReady: 'Dataset verified and ready for real neural training.',
      datasetLabel: 'Source Dataset',
      architectureLabel: 'Model Architecture',
      backendEngineLabel: 'Compute Runtime',
      browserEngineBadge: 'In-Browser Neural Engine (TensorFlow.js)',
      pythonEngineBadge: 'Python FastAPI Worker (PyTorch / YOLO)',
      pythonOfflineHint: 'Python worker is currently offline/unconfigured. Switch to an In-Browser TensorFlow.js model to train immediately, or start ai_engine/main.py.',
      modeBeginnerDesc: 'Beginner Mode auto-tunes epochs, batch size, learning rate, and optimizer for your dataset size.',
      modeAdvancedDesc: 'Advanced Mode exposes full control over optimizer, learning rate, input resolution, thresholds, and early stopping.',
      epochsLabel: 'Epochs',
      batchSizeLabel: 'Batch Size',
      learningRateLabel: 'Learning Rate',
      optimizerLabel: 'Optimizer',
      inputSizeLabel: 'Input Size (px)',
      confThresholdLabel: 'Confidence Threshold',
      iouThresholdLabel: 'IoU Threshold',
      patienceLabel: 'Early Stop Patience',
      saveCheckpointsLabel: 'Save Best Model Checkpoints to IndexedDB',
      startTrainingBtn: 'Start Real Training',
      pauseBtn: 'Pause',
      resumeBtn: 'Resume',
      cancelBtn: 'Cancel',
      liveProgressTitle: 'Live Training Progress',
      lossChartTitle: 'Training & Validation Loss',
      metricChartTitle: 'Accuracy / mAP@50 Progression',
      logsTitle: 'Real-Time Training Logs',
      epochLabel: 'Epoch',
      bestEpochLabel: 'Best Epoch',
      hardwareLabel: 'Active Hardware',
      trainedModelsTitle: 'Trained Models & Evaluation Summary',
      trainedModelsEmpty: 'No trained models yet. Start a real training run above to produce weights and metrics.',
      accuracyLabel: 'Accuracy',
      precisionLabel: 'Precision',
      recallLabel: 'Recall',
      f1Label: 'F1 Score',
      map50Label: 'mAP@0.50',
      latencyLabel: 'Inference Speed',
      modelSizeLabel: 'Weights Size',
      paramsLabel: 'Parameters',
      confusionTitle: 'Confusion Matrix',
      perClassTitle: 'Per-Class Evaluation',
      exportWeightsBtn: 'Export Weights (.json + .bin)',
      setActiveBtn: 'Set Active',
      activeModelLabel: 'Active Model',
      deleteModelBtn: 'Delete Model',
      quickTestTitle: 'Real Model Inference Test',
      quickTestDesc: 'Run real forward-pass inference with the saved weights on any image.',
      uploadTestImageBtn: 'Select Test Image',
      recentRunsTitle: 'Training Run History',
      statusQueued: 'Queued',
      statusRunning: 'Running',
      statusPaused: 'Paused',
      statusCompleted: 'Completed',
      statusCancelled: 'Cancelled',
      statusFailed: 'Failed',
    },
    evaluationStudio: {
      heading: 'Model Evaluation Studio',
      subheading: 'Run real forward-pass benchmarks on held-out Test/Validation images, inspect per-sample errors, compare models side-by-side, and test live camera frames.',
      emptyTitle: 'No Trained Models to Evaluate',
      emptyDesc: 'Train a real Computer Vision model in the Training tab first before running evaluation benchmarks.',
      goToTrainingBtn: 'Open Training Studio',
      batchRunnerTitle: 'Batch Dataset Split Benchmark',
      selectModelLabel: 'Model to Evaluate',
      selectSplitLabel: 'Evaluation Split',
      splitTest: 'Test Split (Held-Out)',
      splitVal: 'Validation Split',
      splitAll: 'All Annotated Images',
      confThresholdLabel: 'Confidence Threshold',
      iouThresholdLabel: 'IoU Match Threshold',
      runEvalBtn: 'Run Real Evaluation',
      runningEvalBtn: 'Evaluating',
      saveSnapshotBtn: 'Save Snapshot to History',
      savingSnapshotBtn: 'Saving...',
      snapshotSavedNotice: 'Evaluation snapshot saved to project history.',
      noLocalWeightsError: 'Local binary weights for this model were not found in this browser IndexedDB. Train on this browser or import a portable .mkmodel.json bundle.',
      evaluatedCountLabel: 'Evaluated Samples',
      avgLatencyLabel: 'Avg Inference',
      p95LatencyLabel: 'P95 Latency',
      throughputLabel: 'Est. Throughput',
      confusionHint: 'Click any Confusion Matrix cell to filter inspected samples below.',
      clearCellFilter: 'Clear Matrix Filter',
      sampleInspectorTitle: 'Sample-by-Sample Prediction Inspector',
      filterAll: 'All Samples',
      filterErrors: 'Misclassified / Errors',
      filterCorrect: 'Exact Matches',
      groundTruthLabel: 'Ground Truth',
      predictedLabel: 'Predicted',
      comparisonTitle: 'Multi-Model Side-by-Side Comparison',
      comparisonDesc: 'Select 2 or more trained models to compare accuracy, mAP@50, latency, size, and dataset lineage.',
      liveLabTitle: 'Live Image & Camera Inference Lab',
      liveLabDesc: 'Test the selected model on an uploaded image or live device camera capture.',
      uploadImageBtn: 'Upload Test Image',
      startCameraBtn: 'Start Live Camera',
      captureAndPredictBtn: 'Capture & Predict',
      stopCameraBtn: 'Stop Camera',
      savedReportsTitle: 'Saved Evaluation Snapshots',
      savedReportsEmpty: 'No saved evaluation snapshots yet. Run an evaluation above and click Save Snapshot.',
      deleteReportBtn: 'Delete',
      bestHighlightLabel: 'Best',
    },
    modelHub: {
      heading: 'MK AI Model Hub & Registry',
      subheading: 'Manage versioned models, verify on-device weight readiness, export portable bundles and inference code, and prepare the active model for App Builder.',
      emptyTitle: 'Model Registry is Empty',
      emptyDesc: 'Completed models from the Training Studio appear here with full version lineage and export formats.',
      searchPlaceholder: 'Search models or architectures...',
      filterAll: 'All Models',
      filterActive: 'Active Only',
      filterOnDevice: 'On-Device Ready',
      versionPrefix: 'Version',
      weightsReady: 'Weights Stored Locally',
      weightsMissing: 'Metadata Only (Different Device)',
      setActiveBtn: 'Set Active for App Builder',
      activeTargetLabel: 'Active App Builder Model',
      renameBtn: 'Rename',
      saveNameBtn: 'Save',
      cancelRenameBtn: 'Cancel',
      compatibilityTitle: 'Target Device & Runtime Readiness',
      desktopReady: 'Desktop Browser (WebGL/CPU)',
      mobileReady: 'Mobile Web / PWA',
      tabletReady: 'Tablet Inspection UI',
      offlineReady: 'Offline Edge Execution',
      compatibleYes: 'Verified',
      compatibleNo: 'Server Only',
      exportPanelTitle: 'Model Artifacts, Reports & Inference Code',
      exportTfjsBtn: 'TF.js (.model.json + .bin)',
      exportBundleBtn: 'Portable Bundle (.mkmodel.json)',
      exportCardJsonBtn: 'Evaluation Card (JSON)',
      exportCardCsvBtn: 'Metrics Table (CSV)',
      exportTsBtn: 'Browser Starter (.ts)',
      exportPyBtn: 'Python Starter (.py)',
      continueAppBuilderBtn: 'Use in App Builder',
      deleteModelBtn: 'Delete Model',
      confirmDeleteBtn: 'Confirm Delete',
    },
    appBuilder: {
      heading: 'MK App Builder & Standalone PWA Studio',
      subheading:
        'Turn your trained Computer Vision model into a customizable, standalone, offline-ready application for desktop, tablet, and mobile.',
      emptyTitle: 'Train a model before building an app',
      emptyDesc:
        'Complete a real training run in Training Studio first so App Builder can bind real neural weights and classes.',
      goTrainingBtn: 'Open Training Studio',
      savedAppsLabel: 'Saved Applications',
      newAppBtn: 'New App',
      saveAppBtn: 'Create & Save App',
      savingBtn: 'Saving...',
      updateAppBtn: 'Save Changes',
      deleteAppBtn: 'Delete App',
      confirmDeleteBtn: 'Confirm Delete',
      savedNotice: 'Application configuration saved to Firestore.',
      configIdentityTitle: '01. App Identity, Tier & Branding',
      tierLabel: 'App Tier',
      tierBasic: 'Basic',
      tierBasicDesc: 'Clean single-screen image & camera classifier/detector.',
      tierCustom: 'Custom',
      tierCustomDesc: 'Custom branding, theme surface, thresholds, and input toggles.',
      tierProfessional: 'Professional',
      tierProfessionalDesc: 'Inspection alert gates, video scan, history table, and CSV export.',
      appNameLabel: 'Application Name',
      shortNameLabel: 'PWA Short Name (max 12 chars)',
      customHeaderLabel: 'Custom Header Title',
      appDescLabel: 'Application Description',
      themeColorLabel: 'Primary Accent Color',
      surfaceModeLabel: 'Default App Surface',
      surfaceLight: 'Light Surface',
      surfaceDark: 'Dark Surface',
      modelRuntimeTitle: '02. Model Binding & Runtime Compatibility',
      targetModelLabel: 'Trained Model Version',
      runtimeTargetLabel: 'Execution Target',
      runtimeOnDevice: 'On-Device Offline PWA (TensorFlow.js)',
      runtimeHybridCloud: 'Hybrid Cloud / Python Worker API',
      weightsVerified: 'Local TF.js weights verified in IndexedDB (ready for standalone bundle)',
      weightsNotLocal: 'Local browser weights missing — train a TF.js model on this browser for offline export.',
      onDeviceBlockedHint: 'Selected model is server-only (onDeviceCompatible = false). Switch to Hybrid Cloud or pick a TF.js model.',
      controlsAlertTitle: '03. Input Sources, Telemetry & Alert Gates',
      inputSourcesLabel: 'Enabled Input Sources',
      sourceCamera: 'Live Camera',
      sourceUpload: 'Image Upload',
      sourceVideo: 'Video Frame Scan',
      confThresholdLabel: 'Confidence Threshold',
      iouThresholdLabel: 'IoU NMS Threshold',
      showConfidenceLabel: 'Display Confidence Scores',
      showLatencyLabel: 'Display Inference Latency (ms)',
      showHistoryLabel: 'Record Inspection History Table',
      allowCsvExportLabel: 'Allow CSV Log Export',
      alertRuleLabel: 'Enable Inspection Alert Banner',
      alertClassLabel: 'Trigger Class',
      alertMinConfLabel: 'Min Alert Confidence',
      previewTitle: 'Live Interactive App Runner (Real Model Inference)',
      viewportDesktop: 'Desktop',
      viewportTablet: 'Tablet',
      viewportMobile: 'Mobile',
      launchStandaloneBtn: 'Launch Full-Screen Mode',
      exitStandaloneBtn: 'Exit Standalone View',
      uploadTestBtn: 'Upload Image',
      cameraStartBtn: 'Start Live Camera',
      cameraStopBtn: 'Stop Camera',
      videoScanBtn: 'Load & Scan Video',
      predictionOutputTitle: 'Live Prediction Output',
      latencyReadout: 'Inference Latency',
      alertTriggeredLabel: 'ALERT TRIGGERED',
      historyLogTitle: 'Inspection Log',
      exportCsvBtn: 'Export CSV',
      clearHistoryBtn: 'Clear',
      noPredictionYet: 'Upload an image, start live camera, or load a video to run real inference inside the generated app.',
      pwaExportTitle: '04. PWA Readiness & Standalone Package Export',
      readinessTitle: 'PWA & Standalone Checklist',
      checkWeights: 'Neural weights verified in local IndexedDB',
      checkManifest: 'Valid PWA short_name (≤ 12 chars) & #RRGGBB theme color',
      checkOfflineRuntime: 'On-device offline runtime compatible',
      checkServiceWorker: 'Service Worker + Web App Manifest generator ready',
      downloadStandaloneBtn: 'Standalone App (.html)',
      downloadManifestBtn: 'manifest.webmanifest',
      downloadSwBtn: 'Service Worker (sw.js)',
      downloadIconBtn: 'App Icon (.svg)',
      downloadReadmeBtn: 'Host Guide (README.md)',
      downloadConfigBtn: 'Config (.mkapp.json)',
    },
    pwa: {
      installAppBtn: 'Install MK AI App',
      installIosBtn: 'Install on iPhone / iPad',
      installGuideBtn: 'Install Desktop / Mobile PWA',
      guideTitle: 'Install MK AI as Standalone App',
      iosInstructions:
        'Open Safari Share menu and tap "Add to Home Screen" to install MK AI as a standalone offline-ready app.',
      desktopInstructions:
        'Use your browser address bar "Install MK AI" button (or browser menu -> Install App) to run MK AI in a standalone window.',
      closeGuide: 'Got it',
      offlineNotice: 'Offline Mode — Cached app shell and local IndexedDB models active.',
    },
    architectureView: {
      heading: 'System Architecture & Development Roadmap',
      subheading: 'Live backend gateway verification, multi-cloud adapter status, and phased engineering plan.',
      backendHealthTitle: 'API Gateway & Multi-Cloud Adapters',
      refreshHealth: 'Refresh Status',
      aiEngineProbeTitle: 'Python AI Training Engine Probe',
      cloudAdapterTitle: 'Active Provider Adapters',
      roadmapTitle: 'Engineering Roadmap',
      storageAdapter: 'Storage Adapter',
      computeAdapter: 'Compute Adapter',
      statusOk: 'Operational',
      statusOffline: 'Unavailable',
    },
    settingsView: {
      heading: 'Account, Security & Credits',
      subheading: 'Manage your MK AI profile, language/theme preferences, and verified session state.',
      profileSection: 'Profile Information',
      displayNameLabel: 'Display Name',
      emailLabel: 'Verified Email',
      saveProfile: 'Update Profile',
      preferencesSection: 'Interface Preferences',
      securitySection: 'Security & Authentication',
      twoFactorLabel: 'Two-Factor Authentication (2FA)',
      twoFactorDesc:
        'Managed via your Google / Identity Provider security policy. Hardware keys and TOTP are supported.',
      sessionSection: 'Active Backend Session',
      verifySessionBtn: 'Verify Server Token',
      billingSection: 'Plan, Storage & Cloud Credits',
      currentPlan: 'Current Plan',
      planFree: 'Free Starter Plan',
      creditsBalance: 'Cloud Credits Balance',
      storageQuota: 'Storage Quota',
    },
    statuses: {
      draft: 'Draft',
      dataset_ready: 'Dataset Ready',
      training: 'Training',
      trained: 'Trained',
      deployed: 'Deployed',
    },
    actions: {
      project_created: 'Created project',
      project_updated: 'Updated project',
      project_deleted: 'Deleted project',
      workspace_created: 'Created workspace',
      settings_updated: 'Updated settings',
      dataset_created: 'Created dataset',
      dataset_updated: 'Updated dataset',
      dataset_exported: 'Exported dataset',
      training_started: 'Started training',
      training_completed: 'Trained model',
      training_cancelled: 'Cancelled training',
      model_evaluated: 'Evaluated model',
      model_exported: 'Exported model',
      model_activated: 'Activated model',
      model_deleted: 'Deleted model',
      app_created: 'Created app',
      app_updated: 'Updated app',
      app_exported: 'Exported app package',
      app_deleted: 'Deleted app',
    },
    common: {
      loading: 'Loading...',
      errorTitle: 'Operation Error',
      retry: 'Retry',
      close: 'Close',
      datasets: 'Datasets',
      models: 'Models',
      apps: 'Apps',
      openWorkspace: 'Open',
      noDescription: 'No description provided.',
    },
  },
  ar: {
    brandName: 'MK AI',
    brandCompany: 'MK Tech',
    nav: {
      dashboard: 'لوحة التحكم',
      projects: 'المشروعات',
      workspaces: 'مساحات العمل',
      architecture: 'المعمارية وخارطة الطريق',
      settings: 'الحساب والأمان',
      signOut: 'تسجيل الخروج',
    },
    topBar: {
      newProject: 'مشروع جديد',
      backToProjects: 'جميع المشروعات',
      lightMode: 'نهاري',
      darkMode: 'ليلي',
      languageLabel: 'English',
    },
    auth: {
      title: 'منصة MK AI للرؤية الحاسوبية',
      subtitle:
        'درّب نماذج ذكاء اصطناعي حقيقية للرؤية الحاسوبية، وحوّلها إلى تطبيقات مستقلة قابلة للتثبيت.',
      featureLine1: 'تدريب حقيقي عبر PyTorch و Ultralytics YOLO — بدون أي نتائج وهمية أو محاكاة.',
      featureLine2: 'خصوصية افتراضية مع تخزين محلي أولاً وموافقة صريحة قبل الرفع السحابي.',
      featureLine3: 'توليد وتصدير تطبيقات PWA مستقلة لأجهزة الكمبيوتر و Android و iOS.',
      googleCta: 'المتابعة باستخدام Google',
      dividerOr: 'أو عبر البريد الإلكتروني',
      emailLabel: 'البريد الإلكتروني',
      passwordLabel: 'كلمة المرور',
      nameLabel: 'الاسم الكامل',
      signInEmail: 'تسجيل الدخول',
      createAccount: 'إنشاء حساب',
      resetPassword: 'نسيت كلمة المرور؟',
      switchToRegister: 'إنشاء حساب بالبريد الإلكتروني',
      switchToLogin: 'لديك حساب بالفعل؟ سجّل الدخول',
      verifyEmailNotice:
        'يرجى تأكيد بريدك الإلكتروني قبل إنشاء المشروعات أو حفظ البيانات في مساحة العمل.',
      resendVerification: 'إعادة إرسال رابط التأكيد',
      verificationSent: 'تم إرسال رسالة التأكيد. تفقد بريدك ثم حدّث الصفحة بعد التفعيل.',
      resetSent: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.',
      emailProviderHelp:
        'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل في إعدادات Firebase Console لهذا المشروع. استخدم زر Google أعلاه أو فعّل Email/Password من Firebase Console.',
      enterpriseProvidersNote:
        'يمكن تفعيل مزودي Microsoft و Apple والمصادقة الثنائية 2FA من لوحة مزودي الهوية في Firebase.',
      signingIn: 'جارٍ تسجيل الدخول...',
    },
    dashboard: {
      heading: 'نظرة عامة على مساحة العمل',
      subheading: 'إدارة مشروعات الرؤية الحاسوبية وسعة التخزين وبنية التدريب الفعلية.',
      totalProjects: 'إجمالي المشروعات',
      trainedModels: 'النماذج المدربة',
      generatedApps: 'التطبيقات المنشأة',
      storageUsed: 'مساحة التخزين',
      cloudCredits: 'رصيد Cloud Credits',
      recentTrainingTitle: 'آخر عمليات التدريب',
      recentTrainingEmpty: 'لم يتم تنفيذ عمليات تدريب بعد',
      recentTrainingEmptyDesc:
        'تظهر مقاييس التدريب الحقيقية هنا فور تنفيذ عملية تدريب على بياناتك عبر محرك Python AI Engine في المرحلة 3.',
      projectsTitle: 'مشروعات الرؤية الحاسوبية',
      projectsEmpty: 'لا توجد مشروعات بعد',
      projectsEmptyDesc:
        'أنشئ مشروعك الأول لتحديد نوع مهمة الذكاء الاصطناعي وتفضيلات التخزين والخصوصية.',
      createFirstProject: 'إنشاء أول مشروع',
      activityTitle: 'آخر الأنشطة',
      activityEmpty: 'لا توجد أنشطة مسجلة حتى الآن.',
      viewAllProjects: 'فتح مساحة العمل',
      searchPlaceholder: 'ابحث في المشروعات...',
      filterAll: 'كل المهام',
    },
    tasks: {
      image_classification: 'تصنيف الصور (Image Classification)',
      image_classification_desc: 'تصنيف الصور الكاملة إلى فئات مخصصة باستخدام MobileNetV3 أو EfficientNet.',
      object_detection: 'اكتشاف العناصر (Object Detection)',
      object_detection_desc: 'تحديد مواقع العناصر ورسم مربعات الإحاطة باستخدام YOLO أو RT-DETR.',
      image_segmentation: 'تجزئة الصور (Segmentation)',
      anomaly_detection: 'اكتشاف الشذوذ (Anomaly Detection)',
      pose_estimation: 'تقدير الوضعية (Pose Estimation)',
      ocr_text: 'قراءة النصوص (OCR)',
      video_recognition: 'تحليل الفيديو (Video Recognition)',
      custom: 'مهام مخصصة (Custom AI)',
      availableV1: 'جاهز V1.0',
      comingSoon: 'قريباً',
    },
    projectModal: {
      title: 'إنشاء مشروع ذكاء اصطناعي جديد',
      subtitle: 'حدد نوع المهمة ونمط التدريب وإعدادات الخصوصية والتخزين.',
      nameLabel: 'اسم المشروع',
      namePlaceholder: 'مثال: فحص جودة اللوحات الإلكترونية',
      descLabel: 'وصف المشروع',
      descPlaceholder: 'صف هدف الفحص البصري وبيئة التشغيل المتوقعة...',
      workspaceLabel: 'مساحة العمل',
      taskLabel: 'مهمة الذكاء الاصطناعي (متاح في V1.0)',
      futureTasksLabel: 'المهام المستقبلية المجدولة',
      modeLabel: 'نمط تجربة التدريب',
      beginnerMode: 'النمط السهل (Beginner)',
      beginnerDesc: 'اختيار تلقائي للبنية والإعدادات المثلى.',
      advancedMode: 'النمط المتقدم (Advanced)',
      advancedDesc: 'تحكم كامل في Epochs و Batch Size و Optimizer والعتبات.',
      storageLabel: 'مكان التخزين والخصوصية',
      localStorage: 'محلي أولاً (خاص)',
      localStorageDesc: 'حفظ البيانات محلياً وعدم رفعها للسحابة إلا بموافقتك.',
      cloudStorage: 'مزامنة سحابية (Cloud Sync)',
      cloudStorageDesc: 'حفظ البيانات ونقاط التوقف عبر طبقة التخزين السحابي متعددة المزودين.',
      cloudConsentLabel:
        'أوافق صراحةً على رفع بيانات المشروع ومخرجاته إلى مزود التخزين السحابي المهيأ.',
      cancel: 'إلغاء',
      create: 'إنشاء المشروع',
      creating: 'جارٍ الإنشاء...',
    },
    workspaceView: {
      heading: 'مساحات العمل وإدارة الصلاحيات',
      subheading: 'تنظيم المشروعات الشخصية وتجهيز بنية صلاحيات الفريق RBAC.',
      createWorkspace: 'مساحة عمل جديدة',
      workspaceName: 'اسم مساحة العمل',
      workspaceType: 'نوع المساحة',
      personal: 'شخصية (Personal)',
      team: 'فريق (Team - RBAC)',
      storageMode: 'التخزين الافتراضي',
      regionLabel: 'المنطقة / النطاق',
      rolesTitle: 'بنية أدوار الفريق (RBAC)',
      rolesSubtitle:
        'قواعد الأمان وجداول العضوية الفرعية في قاعدة البيانات مهيأة للتوسع الجماعي.',
      roleOwner: 'Owner — صلاحية كاملة للمساحة والفوترة والحذف',
      roleAdmin: 'Admin — إدارة الأعضاء والمشروعات والربط السحابي',
      roleTrainer: 'Trainer — إعداد وتشغيل عمليات التدريب الفعلية',
      roleAnnotator: 'Annotator — رفع الصور ورسم مربعات التحديد',
      roleViewer: 'Viewer — عرض نتائج التقييم والتطبيقات فقط',
      createAction: 'إنشاء مساحة العمل',
    },
    projectWorkspace: {
      tabs: {
        overview: 'نظرة عامة',
        dataset: 'البيانات',
        annotation: 'التحديد والتصنيف',
        training: 'التدريب',
        evaluation: 'التقييم',
        model_hub: 'مكتبة النماذج',
        app_builder: 'منشئ التطبيقات',
        deployment: 'النشر والتصدير',
        settings: 'الإعدادات',
      },
      togglePanels: 'إظهار/إخفاء اللوحة الجانبية',
      pipelineReadiness: 'جاهزية مراحل دورة العمل',
      phase1Title: 'المرحلة 1 — تأسيس المشروع',
      phase1Desc: 'بيانات المشروع والملكية وموافقة التخزين وسجل الأنشطة مفعّلة وتعمل.',
      phase2Title: 'المرحلة 2 — استوديو البيانات MK Dataset Studio',
      phase2Desc:
        'رفع الصور والفيديو والتصوير بالكاميرا ورسم Bounding Boxes وفحص الجودة وإعدادات Augmentation مفعّلة الآن.',
      phase3Title: 'المرحلة 3 — محرك التدريب الحقيقي (TensorFlow.js & Python)',
      phase3Desc:
        'تدريب حقيقي بالشبكات العصبية في المتصفح (TensorFlow.js) ومع محرك Python PyTorch/YOLO، مع الرسوم الحية ونقاط الحفظ.',
      phase4Title: 'المرحلة 4 — مكتبة النماذج والتقييم',
      phase4Desc:
        'تقييم الدفعات على تقسيم الاختبار، مصفوفة الارتباك التفاعلية، مقارنة النماذج جنباً إلى جنب، اختبار الكاميرا الحية، ومكتبة النماذج بإصداراتها وتصديراتها مفعّلة الآن.',
      phase5Title: 'المرحلة 5 — منشئ التطبيقات MK App Builder',
      phase5Desc:
        'منشئ التطبيقات (Basic / Custom / Professional)، التشغيل الحي داخل المعاينة بأوزان TF.js، وحزم PWA المستقلة مفعّلة الآن.',
      phase6Title: 'المرحلة 6 — النشر والتخزين الهجين',
      phase6Desc:
        'استضافة MK AI والتراجع للإصدارات والتصدير الخارجي والربط مع Drive و OneDrive تتفعل في المرحلة 6.',
      engineStatusTitle: 'حالة الاتصال بمحرك التدريب Python AI Engine',
      engineProbeBtn: 'فحص اتصال المحرك',
      engineProbing: 'جارٍ الفحص...',
      engineNotConfigured: 'غير مهيأ',
      engineOffline: 'غير متصل',
      engineOnline: 'متصل وجاهز',
      noFakeTrainingRule:
        'يُمنع عرض أي نتائج أو منحنيات تدريب وهمية. قم بتشغيل خدمة Python FastAPI لفحص عتاد CPU/CUDA الفعلي.',
      saveSettings: 'حفظ التعديلات',
      saving: 'جارٍ الحفظ...',
      savedNotice: 'تم تحديث إعدادات المشروع.',
      dangerZone: 'منطقة الخطر',
      deleteProject: 'حذف المشروع',
      deleteConfirm: 'هل أنت متأكد من حذف هذا المشروع نهائياً؟ لا يمكن التراجع عن هذه العملية.',
      confirmDeleteBtn: 'تأكيد الحذف',
    },
    datasetStudio: {
      createTitle: 'إنشاء مجموعة بيانات (Dataset)',
      createSubtitle: 'أنشئ مجموعة بيانات بإصدار محدد لهذا المشروع. تُحفظ ملفات الصور محلياً في IndexedDB بخصوصية كاملة.',
      datasetName: 'اسم مجموعة البيانات',
      datasetNamePlaceholder: 'مثال: خط الإنتاج - الإصدار 1',
      datasetDesc: 'وصف البيانات',
      initialClasses: 'الفئات المبدئية (مفصولة بفاصلة)',
      initialClassesHint: 'مثال: سليم, خدش, قطعة_ناقصة',
      createBtn: 'إنشاء مجموعة البيانات',
      creatingBtn: 'جارٍ الإنشاء...',
      activeDataset: 'مجموعة البيانات النشطة',
      newDatasetBtn: 'مجموعة جديدة',
      subTabs: {
        ingest: 'الجمع والاستيراد',
        classesSplits: 'الفئات والتقسيم',
        quality: 'فحص الجودة',
        augmentation: 'معالجة Augmentation',
      },
      uploadImagesTitle: 'رفع الصور',
      uploadImagesDesc: 'اختر صوراً بصيغة JPG أو PNG أو WebP. يتم حساب البصمة SHA-256 ودرجة الحدة محلياً.',
      selectImagesBtn: 'اختيار صور',
      uploadVideoTitle: 'استخراج الإطارات من الفيديو',
      uploadVideoDesc: 'استخرج صوراً تلقائياً من مقاطع MP4/WebM حسب الفاصل الزمني المحدد.',
      intervalLabel: 'الفاصل الزمني (ثانية)',
      maxFramesLabel: 'الحد الأقصى للإطارات',
      extractFramesBtn: 'اختيار فيديو واستخراج',
      cameraTitle: 'التصوير المباشر والتصوير المستمر',
      cameraDesc: 'التقط صوراً فردية أو متتابعة مباشرة من كاميرا الكمبيوتر أو الجوال.',
      startCameraBtn: 'تشغيل الكاميرا',
      stopCameraBtn: 'إيقاف الكاميرا',
      switchCameraBtn: 'تبديل العدسة',
      captureSingleBtn: 'التقاط صورة',
      startBurstBtn: 'بدء الالتقاط المستمر',
      stopBurstBtn: 'إيقاف الالتقاط',
      importTitle: 'استيراد وتصدير البيانات',
      importDesc: 'استورد مجموعات YOLO (.txt + صور) أو COCO (.json + صور)، أو صدّر البيانات مع الحفاظ على التقسيم.',
      importYoloBtn: 'استيراد ملفات YOLO',
      importCocoBtn: 'استيراد COCO JSON + صور',
      exportYoloBtn: 'تصدير بصيغة YOLO',
      exportCocoBtn: 'تصدير بصيغة COCO JSON',
      classesTitle: 'إدارة الفئات (Classes)',
      addClassPlaceholder: 'اسم الفئة الجديدة',
      addClassBtn: 'إضافة فئة',
      splitsTitle: 'تقسيم البيانات (Train / Validation / Test)',
      trainSplit: 'تدريب Train %',
      valSplit: 'تحقق Val %',
      testSplit: 'اختبار Test %',
      applySplitsBtn: 'حفظ وتوزيع التقسيم',
      splitSumError: 'يجب أن يكون مجموع نسب التقسيم 100% بالضبط.',
      qualityTitle: 'فحص جودة البيانات (Data Quality Audit)',
      totalImages: 'إجمالي الصور',
      annotatedImages: 'الصور المصنفة',
      approvedImages: 'المعتمدة بعد المراجعة',
      imbalanceRatio: 'نسبة عدم توازن الفئات',
      duplicatesLabel: 'صور مكررة (SHA-256)',
      missingAnnotationsLabel: 'صور بدون تصنيف أو تحديد',
      invalidAnnotationsLabel: 'تحديدات غير صالحة أو خارج الإطار',
      lowResLabel: 'دقة منخفضة (< 224px)',
      blurryLabel: 'احتمال ضبابية (Laplacian < 45)',
      noIssues: 'لم يتم رصد مشاكل في هذا الفحص.',
      removeDuplicatesBtn: 'حذف النسخ المكررة',
      classDistribution: 'توزيع الفئات',
      augmentationTitle: 'إعدادات تحسين البيانات (Augmentation)',
      augmentationLeakageRule:
        'حماية من تسريب البيانات: تُطبق التحويلات على بيانات التدريب (Train) فقط، وتبقى بيانات التحقق والاختبار كما هي.',
      rotateLabel: 'أقصى زاوية دوران (درجة)',
      flipHLabel: 'قلب أفقي',
      flipVLabel: 'قلب عمودي',
      brightnessLabel: 'تعديل الإضاءة (%)',
      contrastLabel: 'تعديل التباين (%)',
      noiseLabel: 'إضافة ضوضاء',
      blurLabel: 'نصف قطر التمويه (px)',
      resizeLabel: 'أبعاد الإدخال المستهدفة',
      saveAugBtn: 'حفظ إعدادات Augmentation',
      previewLabel: 'معاينة فورية على صورة حقيقية',
      markReadyBtn: 'اعتماد وتجهيز البيانات للتدريب',
      readyBadge: 'البيانات جاهزة للتدريب',
      galleryTitle: 'مكتبة صور المجموعة',
      openInAnnotator: 'تحديد',
      deleteImage: 'حذف',
    },
    annotationStudio: {
      noDatasetTitle: 'لا توجد مجموعة بيانات',
      noDatasetDesc: 'أنشئ مجموعة بيانات في تبويب البيانات أولاً قبل البدء في التحديد.',
      noImagesTitle: 'لا توجد صور في المجموعة',
      noImagesDesc: 'ارفع صوراً أو استخرج إطارات فيديو أو التقط بالكاميرا من تبويب البيانات.',
      filterAll: 'الكل',
      filterUnlabeled: 'غير مصنفة',
      filterApproved: 'معتمدة',
      prevBtn: 'السابق',
      nextBtn: 'التالي',
      zoomIn: 'تكبير',
      zoomOut: 'تصغير',
      resetView: 'إعادة الضبط',
      approveBtn: 'اعتماد الصورة',
      approvedLabel: 'معتمدة',
      activeClassLabel: 'الفئة النشطة',
      classificationHint: 'اختر الفئة أدناه أو اضغط المفاتيح 1–9 لتصنيف هذه الصورة.',
      detectionHint: 'اضغط واسحب على الصورة لرسم مربع التحديد (Bounding Box) للفئة النشطة.',
      boxesTitle: 'مربعات التحديد',
      deleteBox: 'حذف المربع',
      shortcutsTitle: 'اختصارات لوحة المفاتيح',
      shortcutsDesc: 'A/D أو الأسهم: التنقل · 1-9: اختيار الفئة · Delete: حذف المربع · Space: اعتماد · 0: إعادة التكبير',
      splitLabel: 'التقسيم',
      resolutionLabel: 'الأبعاد',
      blurScoreLabel: 'الحدة',
    },
    trainingStudio: {
      heading: 'استوديو التدريب الحقيقي MK AI',
      subheading: 'درّب شبكات الرؤية الحاسوبية تدريباً فعلياً داخل المتصفح (TensorFlow.js) أو أرسل المهمة إلى خادم Python PyTorch/YOLO المتصل.',
      datasetGateTitle: 'جاهزية البيانات للتدريب',
      datasetGateEmpty: 'أنشئ مجموعة بيانات وأضف صوراً في تبويب البيانات قبل بدء التدريب.',
      datasetGateNeedAnnotated: 'يجب توفر صورتين مصنفتين على الأقل في تقسيم التدريب (Train) لبدء التدريب الفعلي.',
      datasetGateReady: 'مجموعة البيانات جاهزة وموثقة للتدريب الفعلي.',
      datasetLabel: 'مجموعة البيانات المصدرية',
      architectureLabel: 'بنية النموذج',
      backendEngineLabel: 'بيئة التشغيل والحوسبة',
      browserEngineBadge: 'محرك الشبكات المحلي بالمتصفح (TensorFlow.js)',
      pythonEngineBadge: 'خادم Python FastAPI (PyTorch / YOLO)',
      pythonOfflineHint: 'خادم Python غير متصل حالياً. يمكنك اختيار نموذج TensorFlow.js المحلي للتدريب الفوري، أو تشغيل خدمة ai_engine/main.py.',
      modeBeginnerDesc: 'النمط السهل يضبط Epochs و Batch Size ومعدل التعلم والمحسّن تلقائياً حسب حجم بياناتك.',
      modeAdvancedDesc: 'النمط المتقدم يمنحك تحكماً كاملاً في المحسّن ومعدل التعلم والأبعاد والعتبات والإيقاف المبكر.',
      epochsLabel: 'عدد الدورات (Epochs)',
      batchSizeLabel: 'حجم الدفعة (Batch Size)',
      learningRateLabel: 'معدل التعلم (Learning Rate)',
      optimizerLabel: 'المُحسِّن (Optimizer)',
      inputSizeLabel: 'أبعاد الإدخال (px)',
      confThresholdLabel: 'عتبة الثقة (Confidence)',
      iouThresholdLabel: 'عتبة التطابق (IoU)',
      patienceLabel: 'صبر الإيقاف المبكر',
      saveCheckpointsLabel: 'حفظ أفضل نقاط التوقف (Checkpoints) في IndexedDB',
      startTrainingBtn: 'بدء التدريب الحقيقي',
      pauseBtn: 'إيقاف مؤقت',
      resumeBtn: 'استكمال',
      cancelBtn: 'إلغاء',
      liveProgressTitle: 'تقدم التدريب المباشر',
      lossChartTitle: 'منحنى الخسارة (Train / Validation Loss)',
      metricChartTitle: 'تطور الدقة / mAP@50',
      logsTitle: 'سجل التدريب اللحظي',
      epochLabel: 'الدورة',
      bestEpochLabel: 'أفضل دورة',
      hardwareLabel: 'العتاد النشط',
      trainedModelsTitle: 'النماذج المدربة وملخص التقييم',
      trainedModelsEmpty: 'لا توجد نماذج مدربة بعد. ابدأ عملية تدريب حقيقية أعلاه لتوليد الأوزان والمقاييس.',
      accuracyLabel: 'الدقة (Accuracy)',
      precisionLabel: 'الضبط (Precision)',
      recallLabel: 'الاستدعاء (Recall)',
      f1Label: 'معامل F1',
      map50Label: 'mAP@0.50',
      latencyLabel: 'سرعة الاستدلال',
      modelSizeLabel: 'حجم الأوزان',
      paramsLabel: 'المعاملات',
      confusionTitle: 'مصفوفة الارتباك (Confusion Matrix)',
      perClassTitle: 'التقييم لكل فئة',
      exportWeightsBtn: 'تصدير الأوزان (.json + .bin)',
      setActiveBtn: 'تعيين كنموذج نشط',
      activeModelLabel: 'النموذج النشط',
      deleteModelBtn: 'حذف النموذج',
      quickTestTitle: 'اختبار النموذج الفعلي على صورة',
      quickTestDesc: 'اختبر الأوزان المحفوظة بتمرير أمامي حقيقي على أي صورة.',
      uploadTestImageBtn: 'اختيار صورة للاختبار',
      recentRunsTitle: 'سجل عمليات التدريب',
      statusQueued: 'في الانتظار',
      statusRunning: 'قيد التدريب',
      statusPaused: 'متوقف مؤقتاً',
      statusCompleted: 'مكتمل',
      statusCancelled: 'ملغي',
      statusFailed: 'فشل',
    },
    evaluationStudio: {
      heading: 'استوديو تقييم ومقارنة النماذج',
      subheading: 'اختبر النماذج فعلياً على صور تقسيم Test أو Validation، وافحص الأخطاء صورة بصورة، وقارن عدة نماذج جنباً إلى جنب، وجرب الكاميرا الحية.',
      emptyTitle: 'لا توجد نماذج مدربة للتقييم بعد',
      emptyDesc: 'درّب نموذج رؤية حاسوبية حقيقياً في تبويب التدريب أولاً لعرض التقييم والمقارنات هنا.',
      goToTrainingBtn: 'الانتقال إلى استوديو التدريب',
      batchRunnerTitle: 'اختبار الدفعة على تقسيم البيانات',
      selectModelLabel: 'النموذج المستهدف',
      selectSplitLabel: 'تقسيم البيانات',
      splitTest: 'تقسيم الاختبار (Test Split)',
      splitVal: 'تقسيم التحقق (Validation Split)',
      splitAll: 'جميع الصور المصنفة',
      confThresholdLabel: 'عتبة الثقة (Confidence)',
      iouThresholdLabel: 'عتبة التطابق (IoU)',
      runEvalBtn: 'تشغيل التقييم الفعلي',
      runningEvalBtn: 'جارٍ التقييم',
      saveSnapshotBtn: 'حفظ لقطة التقييم في السجل',
      savingSnapshotBtn: 'جارٍ الحفظ...',
      snapshotSavedNotice: 'تم حفظ لقطة التقييم بنجاح في سجل المشروع.',
      noLocalWeightsError: 'الأوزان الثنائية لهذا النموذج غير متوفرة في IndexedDB على هذا المتصفح. درّب النموذج من هذا الجهاز لتشغيل التقييم المحلي.',
      evaluatedCountLabel: 'الصور المختبرة',
      avgLatencyLabel: 'متوسط الاستدلال',
      p95LatencyLabel: 'زمن P95',
      throughputLabel: 'السرعة التقديرية',
      confusionHint: 'اضغط على أي خلية في مصفوفة الارتباك لتصفية الصور أدناه حسب تلك الحالة.',
      clearCellFilter: 'إلغاء تصفية المصفوفة',
      sampleInspectorTitle: 'مفتش التوقعات صورة بصورة',
      filterAll: 'كل العينات',
      filterErrors: 'الأخطاء فقط',
      filterCorrect: 'التطابق الصحيح',
      groundTruthLabel: 'الحقيقة (Ground Truth)',
      predictedLabel: 'التوقع (Predicted)',
      comparisonTitle: 'مقارنة النماذج جنباً إلى جنب',
      comparisonDesc: 'اختر نموذجين أو أكثر لمقارنة الدقة وmAP@50 والسرعة وحجم الأوزان وإصدار البيانات.',
      liveLabTitle: 'مختبر الاختبار الحي بالكاميرا والصور',
      liveLabDesc: 'جرّب النموذج المحدد على صورة من جهازك أو التقاط إطار حي مباشر من الكاميرا.',
      uploadImageBtn: 'رفع صورة للاختبار',
      startCameraBtn: 'تشغيل الكاميرا الحية',
      captureAndPredictBtn: 'التقاط واختبار فوري',
      stopCameraBtn: 'إيقاف الكاميرا',
      savedReportsTitle: 'سجل لقطات التقييم المحفوظة',
      savedReportsEmpty: 'لا توجد لقطات تقييم محفوظة بعد. شغّل تقييماً أعلاه ثم اضغط حفظ.',
      deleteReportBtn: 'حذف',
      bestHighlightLabel: 'الأفضل',
    },
    modelHub: {
      heading: 'مكتبة وإدارة النماذج MK AI Model Hub',
      subheading: 'إدارة إصدارات النماذج، التحقق من جاهزية الأوزان على الجهاز، تصدير الحزم وأكواد التشغيل، وتعيين النموذج النشط لمنشئ التطبيقات.',
      emptyTitle: 'مكتبة النماذج فارغة',
      emptyDesc: 'تظهر النماذج المكتملة من استوديو التدريب هنا مع كامل إصداراتها وصيغ التصدير الخاصة بها.',
      searchPlaceholder: 'ابحث باسم النموذج أو البنية...',
      filterAll: 'كل النماذج',
      filterActive: 'النشط فقط',
      filterOnDevice: 'جاهز على الجهاز',
      versionPrefix: 'إصدار',
      weightsReady: 'الأوزان محفوظة محلياً',
      weightsMissing: 'بيانات وصفية فقط (جهاز آخر)',
      setActiveBtn: 'تعيين كنموذج نشط لمنشئ التطبيقات',
      activeTargetLabel: 'النموذج النشط لمنشئ التطبيقات',
      renameBtn: 'إعادة تسمية',
      saveNameBtn: 'حفظ',
      cancelRenameBtn: 'إلغاء',
      compatibilityTitle: 'جاهزية المنصات وبيئة التشغيل',
      desktopReady: 'متصفح الكمبيوتر (WebGL/CPU)',
      mobileReady: 'تطبيق الويب للجوال (PWA)',
      tabletReady: 'واجهة التابلت اللوحية',
      offlineReady: 'تشغيل أوفلاين على الجهاز',
      compatibleYes: 'متوافق',
      compatibleNo: 'خادم فقط',
      exportPanelTitle: 'تصدير الأوزان والتقارير وأكواد الدمج',
      exportTfjsBtn: 'TF.js (.model.json + .bin)',
      exportBundleBtn: 'حزمة محمولة (.mkmodel.json)',
      exportCardJsonBtn: 'بطاقة التقييم (JSON)',
      exportCardCsvBtn: 'جدول المقاييس (CSV)',
      exportTsBtn: 'كود المتصفح (.ts)',
      exportPyBtn: 'كود بايثون (.py)',
      continueAppBuilderBtn: 'استخدام في منشئ التطبيقات',
      deleteModelBtn: 'حذف النموذج',
      confirmDeleteBtn: 'تأكيد الحذف',
    },
    appBuilder: {
      heading: 'منشئ التطبيقات MK App Builder وحزم PWA المستقلة',
      subheading:
        'حوّل نموذج الرؤية الحاسوبية المدرّب إلى تطبيق مستقل مخصص وقابل للتثبيت والعمل دون اتصال على الكمبيوتر والتابلت والموبايل.',
      emptyTitle: 'درّب نموذجاً أولاً قبل بناء التطبيق',
      emptyDesc:
        'أتمم عملية تدريب حقيقية في استوديو التدريب ليتمكن منشئ التطبيقات من ربط الأوزان والفئات الفعلية.',
      goTrainingBtn: 'الانتقال إلى استوديو التدريب',
      savedAppsLabel: 'التطبيقات المحفوظة',
      newAppBtn: 'تطبيق جديد',
      saveAppBtn: 'إنشاء وحفظ التطبيق',
      savingBtn: 'جارٍ الحفظ...',
      updateAppBtn: 'حفظ التعديلات',
      deleteAppBtn: 'حذف التطبيق',
      confirmDeleteBtn: 'تأكيد الحذف',
      savedNotice: 'تم حفظ إعدادات التطبيق في قاعدة البيانات.',
      configIdentityTitle: '01. هوية التطبيق والمستوى والتصميم',
      tierLabel: 'مستوى التطبيق',
      tierBasic: 'أساسي Basic',
      tierBasicDesc: 'واجهة سريعة لرفع الصور والكاميرا وعرض النتيجة مباشرة.',
      tierCustom: 'مخصص Custom',
      tierCustomDesc: 'تخصيص الألوان والمظهر والعنوان والعتبات ومصادر الإدخال.',
      tierProfessional: 'احترافي Professional',
      tierProfessionalDesc: 'قواعد تنبيه الفحص، مسح الفيديو، سجل الفحوصات، وتصدير CSV.',
      appNameLabel: 'اسم التطبيق',
      shortNameLabel: 'الاسم المختصر PWA (بحد أقصى 12 حرف)',
      customHeaderLabel: 'عنوان الرأس المخصص',
      appDescLabel: 'وصف التطبيق',
      themeColorLabel: 'اللون الأساسي للتطبيق',
      surfaceModeLabel: 'مظهر الخلفية الافتراضي',
      surfaceLight: 'مظهر فاتح',
      surfaceDark: 'مظهر داكن',
      modelRuntimeTitle: '02. ربط النموذج وتوافق التشغيل',
      targetModelLabel: 'إصدار النموذج المدرّب',
      runtimeTargetLabel: 'بيئة التشغيل المستهدفة',
      runtimeOnDevice: 'تطبيق PWA محلي دون اتصال (TensorFlow.js)',
      runtimeHybridCloud: 'تشغيل سحابي هجين / خادم Python',
      weightsVerified: 'تم التحقق من أوزان TF.js محلياً في IndexedDB وجاهزة للتضمين',
      weightsNotLocal: 'الأوزان غير مخزنة على هذا المتصفح — درّب نموذج TF.js محلياً لتصدير حزمة أوفلاين.',
      onDeviceBlockedHint: 'النموذج المختار مخصص للخادم فقط (onDeviceCompatible = false). اختر التشغيل الهجين أو نموذج TF.js.',
      controlsAlertTitle: '03. مصادر الإدخال والقياس وقواعد التنبيه',
      inputSourcesLabel: 'مصادر الإدخال المفعلة',
      sourceCamera: 'الكاميرا الحية',
      sourceUpload: 'رفع صورة',
      sourceVideo: 'فحص فيديو',
      confThresholdLabel: 'عتبة الثقة (Confidence)',
      iouThresholdLabel: 'عتبة التطابق (IoU)',
      showConfidenceLabel: 'إظهار نسب الثقة',
      showLatencyLabel: 'إظهار زمن الاستدلال (ms)',
      showHistoryLabel: 'تسجيل جدول تاريخ الفحوصات',
      allowCsvExportLabel: 'تفعيل تصدير السجل بصيغة CSV',
      alertRuleLabel: 'تفعيل قاعدة تنبيه الفحص التلقائي',
      alertClassLabel: 'الفئة المستهدفة للتنبيه',
      alertMinConfLabel: 'الحد الأدنى لثقة التنبيه',
      previewTitle: 'التشغيل والمعاينة الحية للتطبيق (استدلال فعلي)',
      viewportDesktop: 'كمبيوتر',
      viewportTablet: 'تابلت',
      viewportMobile: 'موبايل',
      launchStandaloneBtn: 'تشغيل بملء الشاشة',
      exitStandaloneBtn: 'إغلاق وضع التشغيل الكامل',
      uploadTestBtn: 'اختيار صورة',
      cameraStartBtn: 'تشغيل الكاميرا الحية',
      cameraStopBtn: 'إيقاف الكاميرا',
      videoScanBtn: 'اختيار وفحص فيديو',
      predictionOutputTitle: 'نتائج التنبؤ المباشرة',
      latencyReadout: 'زمن الاستدلال',
      alertTriggeredLabel: 'تم رصد حالة تنبيه',
      historyLogTitle: 'سجل الفحوصات المباشر',
      exportCsvBtn: 'تصدير CSV',
      clearHistoryBtn: 'مسح',
      noPredictionYet: 'ارفع صورة أو شغّل الكاميرا أو حمّل مقطع فيديو لتشغيل الاستدلال الفعلي داخل التطبيق.',
      pwaExportTitle: '04. جاهزية التثبيت PWA وتصدير الحزمة المستقلة',
      readinessTitle: 'قائمة التحقق من الجاهزية',
      checkWeights: 'التحقق من وجود الأوزان العصبية في IndexedDB',
      checkManifest: 'الاسم المختصر (≤ 12 حرف) ولون الهوية #RRGGBB صالحة',
      checkOfflineRuntime: 'توافق التشغيل المحلي دون إنترنت على الجهاز',
      checkServiceWorker: 'ملفات Service Worker و Web App Manifest جاهزة',
      downloadStandaloneBtn: 'تطبيق مستقل (.html)',
      downloadManifestBtn: 'manifest.webmanifest',
      downloadSwBtn: 'ملف الأوفلاين (sw.js)',
      downloadIconBtn: 'أيقونة التطبيق (.svg)',
      downloadReadmeBtn: 'دليل الاستضافة (README.md)',
      downloadConfigBtn: 'ملف الإعدادات (.mkapp.json)',
    },
    pwa: {
      installAppBtn: 'تثبيت تطبيق MK AI',
      installIosBtn: 'تثبيت على iPhone / iPad',
      installGuideBtn: 'تثبيت كتطبيق مستقل PWA',
      guideTitle: 'تثبيت منصة MK AI كتطبيق مستقل',
      iosInstructions:
        'افتح قائمة المشاركة (Share) في متصفح Safari ثم اختر "إضافة إلى الشاشة الرئيسية" لتشغيل MK AI كتطبيق مستقل.',
      desktopInstructions:
        'اضغط أيقونة "تثبيت التطبيق" في شريط عنوان المتصفح لتشغيل MK AI في نافذة مستقلة مع دعم العمل دون اتصال.',
      closeGuide: 'حسناً',
      offlineNotice: 'وضع عدم الاتصال — يتم استخدام الحزمة المخزنة والنماذج المحلية.',
    },
    architectureView: {
      heading: 'المعمارية التقنية وخارطة التطوير',
      subheading: 'فحص مباشر لبوابة الخادم وطبقات المزودين السحابيين ومراحل التنفيذ.',
      backendHealthTitle: 'بوابة API ومحوّلات السحابة المتعددة',
      refreshHealth: 'تحديث الحالة',
      aiEngineProbeTitle: 'فحص محرك التدريب Python AI Engine',
      cloudAdapterTitle: 'محولات التخزين والحوسبة النشطة',
      roadmapTitle: 'خارطة التطوير المرحلية',
      storageAdapter: 'محول التخزين',
      computeAdapter: 'محول الحوسبة',
      statusOk: 'يعمل',
      statusOffline: 'غير متاح',
    },
    settingsView: {
      heading: 'الحساب والأمان والرصيد',
      subheading: 'إدارة ملفك الشخصي وتفضيلات اللغة والمظهر وحالة الجلسة الموثقة.',
      profileSection: 'بيانات الحساب',
      displayNameLabel: 'الاسم الظاهر',
      emailLabel: 'البريد الموثق',
      saveProfile: 'تحديث الملف',
      preferencesSection: 'تفضيلات الواجهة',
      securitySection: 'الأمان والمصادقة',
      twoFactorLabel: 'المصادقة الثنائية (2FA)',
      twoFactorDesc:
        'تُدار عبر إعدادات الحماية في مزود الهوية الخاص بك مع دعم مفاتيح الأمان وتطبيقات التحقق.',
      sessionSection: 'التحقق من جلسة الخادم',
      verifySessionBtn: 'فحص توكن الجلسة',
      billingSection: 'الخطة والتخزين ورصيد الحوسبة',
      currentPlan: 'الخطة الحالية',
      planFree: 'الخطة المجانية الأساسية',
      creditsBalance: 'رصيد Cloud Credits',
      storageQuota: 'الحد الأقصى للتخزين',
    },
    statuses: {
      draft: 'مسودة',
      dataset_ready: 'البيانات جاهزة',
      training: 'قيد التدريب',
      trained: 'مدرّب',
      deployed: 'منشور',
    },
    actions: {
      project_created: 'أنشأ مشروع',
      project_updated: 'حدّث مشروع',
      project_deleted: 'حذف مشروع',
      workspace_created: 'أنشأ مساحة عمل',
      settings_updated: 'حدّث الإعدادات',
      dataset_created: 'أنشأ مجموعة بيانات',
      dataset_updated: 'حدّث مجموعة بيانات',
      dataset_exported: 'صدّر مجموعة بيانات',
      training_started: 'بدأ تدريب',
      training_completed: 'درّب نموذج',
      training_cancelled: 'ألغى تدريب',
      model_evaluated: 'قيّم نموذج',
      model_exported: 'صدّر نموذج',
      model_activated: 'فعّل نموذج',
      model_deleted: 'حذف نموذج',
      app_created: 'أنشأ تطبيق',
      app_updated: 'حدّث تطبيق',
      app_exported: 'صدّر حزمة تطبيق',
      app_deleted: 'حذف تطبيق',
    },
    common: {
      loading: 'جارٍ التحميل...',
      errorTitle: 'تعذر إتمام العملية',
      retry: 'إعادة المحاولة',
      close: 'إغلاق',
      datasets: 'مجموعات البيانات',
      models: 'النماذج',
      apps: 'التطبيقات',
      openWorkspace: 'فتح',
      noDescription: 'لا يوجد وصف مضاف.',
    },
  },
};
