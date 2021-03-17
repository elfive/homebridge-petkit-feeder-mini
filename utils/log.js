'use strict';

class logUtil {
    // log level
    static LOGLV_NONE = 9;
    static LOGLV_DEBUG = 1;
    static LOGLV_INFO = 2;
    static LOGLV_WARN = 3;
    static LOGLV_ERROR = 4;

    constructor(log, log_level = logUtil.LOGLV_INFO) {
        this.log = (level, content) => {
            if (level < log_level || log_level === logUtil.LOGLV_NONE)
                return;

            switch (level) {
                case logUtil.LOGLV_DEBUG:
                    log('[DEBUG] ' + content);
                    break;
                case logUtil.LOGLV_INFO:
                    log('[INFO] ' + content);
                    break;
                case logUtil.LOGLV_WARN:
                    log.warn('[WARN] ' + content);
                    break;
                case logUtil.LOGLV_ERROR:
                default:
                    log.error('[ERROR] ' + content);
                    break;
            }
        };
    }

    debug(log_content) {
        this.log(logUtil.LOGLV_DEBUG, log_content);
    }

    info(log_content) {
        this.log(logUtil.LOGLV_INFO, log_content);
    }

    warn(log_content) {
        this.log(logUtil.LOGLV_WARN, log_content);
    }

    error(log_content) {
        this.log(logUtil.LOGLV_ERROR, log_content);
    }
}
module.exports = logUtil;
