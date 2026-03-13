const SCORM = {
    connected: false,
    api: null,
    
    init() {
        this.api = this.findAPI(window);
        if (!this.api && window.opener) {
            this.api = this.findAPI(window.opener);
        }
        
        if (this.api) {
            const res = this.api.LMSInitialize("");
            if (res === "true") {
                this.connected = true;
                console.log("[SCORM] Initialized successfully");
            }
        } else {
            console.warn("[SCORM] API not found. Running in standalone mode.");
        }
    },

    findAPI(win) {
        let findAttempts = 0;
        const findLimit = 10;
        while (win.LMSInitialize === undefined && win.parent !== undefined && win.parent !== win) {
            findAttempts++;
            if (findAttempts > findLimit) return null;
            win = win.parent;
        }
        return win.LMSInitialize !== undefined ? win : null;
    },

    get(param) {
        if (!this.connected) return null;
        return this.api.LMSGetValue(param);
    },

    set(param, value) {
        if (!this.connected) return false;
        const res = this.api.LMSSetValue(param, value);
        this.api.LMSCommit("");
        return res === "true";
    },

    setScore(score) {
        this.set("cmi.core.score.raw", score);
        this.set("cmi.core.score.min", "0");
        this.set("cmi.core.score.max", "100");
    },

    setComplete() {
        this.set("cmi.core.lesson_status", "completed");
    },

    finish() {
        if (!this.connected) return;
        this.api.LMSFinish("");
    },

    getSuspendData() {
        const data = this.get("cmi.suspend_data");
        try {
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    },

    saveProgressState(location, data) {
        this.set("cmi.core.lesson_location", location);
        this.set("cmi.suspend_data", JSON.stringify(data));
    },

    getBookmark() {
        return this.get("cmi.core.lesson_location");
    }
};
