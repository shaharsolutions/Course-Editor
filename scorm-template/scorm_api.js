var SCORM = {
    connected: false,
    api: null,
    startTime: null,
    
    init() {
        console.log("[SCORM] Searching for API...");
        this.api = this.findAPI(window);
        
        if (!this.api && window.opener) {
            this.api = this.findAPI(window.opener);
        }
        
        if (!this.api && window.parent && window.parent !== window) {
            this.api = this.findAPI(window.parent);
        }

        if (this.api) {
            console.log("[SCORM] API found, initializing...");
            try {
                const res = this.api.LMSInitialize("");
                if (res === "true" || res === true) {
                    this.connected = true;
                    this.startTime = new Date();
                    console.log("[SCORM] Initialized successfully");
                    
                    // Set status to incomplete if not already set to completed
                    const status = this.get("cmi.core.lesson_status");
                    if (status === "not attempted" || status === "unknown") {
                        this.set("cmi.core.lesson_status", "incomplete");
                    }
                } else {
                    const errCode = this.api.LMSGetLastError();
                    const errDesc = this.api.LMSGetErrorString(errCode);
                    console.error(`[SCORM] LMSInitialize failed: ${errDesc} (${errCode})`);
                }
            } catch (e) {
                console.error("[SCORM] Exception during initialization", e);
            }
        } else {
            console.warn("[SCORM] API NOT FOUND - LMS features will be disabled.");
        }
    },

    findAPI(win) {
        let attempts = 0;
        while (win) {
            try {
                if (win.LMSInitialize) return win;
                if (win.API && win.API.LMSInitialize) return win.API;
            } catch (e) {
                console.warn("[SCORM] Security restriction accessing frame/window", e);
            }
            
            try {
                if (win === win.parent) break;
                win = win.parent;
            } catch (e) {
                break;
            }
            attempts++;
            if (attempts > 10) break;
        }
        return null;
    },

    convertMillisecondsToSCORMTime(ms) {
        let seconds = Math.floor(ms / 1000);
        let minutes = Math.floor(seconds / 60);
        seconds = seconds % 60;
        let hours = Math.floor(minutes / 60);
        minutes = minutes % 60;

        const pad = (n) => (n < 10 ? "0" + n : n);
        // SCORM 1.2 Format: HHHH:MM:SS.SS (up to hundredths of a second)
        return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
    },

    get(param) {
        if (!this.connected || !this.api) return null;
        try {
            return this.api.LMSGetValue(param);
        } catch (e) {
            console.error(`[SCORM] Error getting ${param}`, e);
            return null;
        }
    },

    set(param, value) {
        if (!this.connected || !this.api) return false;
        try {
            console.log(`[SCORM] Setting ${param} to ${value}`);
            const res = this.api.LMSSetValue(param, value);
            this.api.LMSCommit("");
            return res === "true" || res === true;
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
        if (!this.connected || !this.api) return;
        try {
            if (this.startTime) {
                const endTime = new Date();
                const sessionTime = this.convertMillisecondsToSCORMTime(endTime - this.startTime);
                this.set("cmi.core.session_time", sessionTime);
                this.startTime = null; // Mark as finished to prevent double calls
            }
            this.api.LMSFinish("");
            this.connected = false; // Disable further calls
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
