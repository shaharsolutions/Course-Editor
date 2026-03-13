const SCORM = {
    connected: false,
    api: null,
    
    init() {
        this.api = this.findAPI(window);
        if (!this.api && window.opener) {
            this.api = this.findAPI(window.opener);
        }
        
        if (this.api) {
            console.log("[SCORM] API found, initializing...");
            try {
                const res = this.api.LMSInitialize("");
                if (res === "true") {
                    this.connected = true;
                    console.log("[SCORM] Initialized successfully");
                } else {
                    console.error("[SCORM] LMSInitialize failed");
                }
            } catch (e) {
                console.error("[SCORM] Exception during initialization", e);
            }
        } else {
            console.warn("[SCORM] API not found. Running in standalone mode.");
        }
    },

    findAPI(win) {
        let findAttempts = 0;
        const findLimit = 10;
        
        // Search up the parent hierarchy
        while (win.LMSInitialize === undefined && win.parent !== undefined && win.parent !== win) {
            findAttempts++;
            if (findAttempts > findLimit) break;
            win = win.parent;
        }
        
        if (win.LMSInitialize !== undefined) return win;

        // Search down into frames (some LMSes do this)
        if (win.frames && win.frames.length > 0) {
            for (let i = 0; i < win.frames.length; i++) {
                if (win.frames[i].LMSInitialize !== undefined) return win.frames[i];
            }
        }

        return null;
    },

    get(param) {
        if (!this.connected) return null;
        try {
            return this.api.LMSGetValue(param);
        } catch (e) {
            console.error(`[SCORM] Error getting ${param}`, e);
            return null;
        }
    },

    set(param, value) {
        if (!this.connected) return false;
        try {
            const res = this.api.LMSSetValue(param, value);
            this.api.LMSCommit("");
            return res === "true";
        } catch (e) {
            console.error(`[SCORM] Error setting ${param}`, e);
            return false;
        }
    },

    setScore(score) {
        this.set("cmi.core.score.raw", String(score));
        this.set("cmi.core.score.min", "0");
        this.set("cmi.core.score.max", "100");
    },

    setComplete() {
        this.set("cmi.core.lesson_status", "completed");
    },

    finish() {
        if (!this.connected) return;
        try {
            this.api.LMSFinish("");
        } catch (e) {
            console.error("[SCORM] Error in LMSFinish", e);
        }
    },

    getSuspendData() {
        const data = this.get("cmi.suspend_data");
        if (!data) return {};
        try {
            return JSON.parse(data);
        } catch (e) {
            console.warn("[SCORM] Failed to parse suspend_data", data);
            return {};
        }
    },

    saveProgressState(location, data) {
        if (location) this.set("cmi.core.lesson_location", String(location));
        if (data) this.set("cmi.suspend_data", JSON.stringify(data));
    },

    getBookmark() {
        return this.get("cmi.core.lesson_location");
    }
};
