'use strict';

// custom UI server for homebridge-petkit-feeder-mini.
//
// this script is spawned by the homebridge config ui as a child process when
// the plugin settings modal is opened, and terminated when the modal is
// closed. it performs the same Petkit login and device discovery requests as
// the plugin itself(see index.js), so the "test login" result in the settings
// page reflects exactly what the plugin will do after saving the config.
//
// note: this script runs in its own process, so the Petkit request logic is
// duplicated from index.js on purpose. the protocol constants below have been
// verified against the official Petkit app, see
// https://github.com/Jezza34000/py-petkit-api for more detail.

const querystring = require('querystring');
const crypto = require('crypto');
const axios = require('axios');

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

// petkit country code -> default server address mapping, generated from the
// official petkit region servers endpoint, shared with the settings page.
const REGION_SERVERS = require('./public/region-servers.js').servers;

// ---------- petkit protocol constants(same as index.js) ----------

const ACCOUNT_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': '*/*',
    'Accept-Language': 'en-US;q=1, it-US;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'User-Agent': 'okhttp/3.14.9',
    'X-Img-Version': '1',
    'X-Locale': 'en-US',
    'X-Client': 'android(16.1;23127PN0CG)',
    'X-Hour': '24',
    'X-Api-Version': '13.2.1',
};

const ACCOUNT_CLIENT = {
    'locale': 'en-US',
    'name': '23127PN0CG',
    'osVersion': '16.1',
    'phoneBrand': 'Xiaomi',
    'platform': 'android',
    'source': 'app.petkit-android',
    'version': '13.2.1',
};

const SUPPORT_DEVICE_TYPE = ['Feeder', 'FeederMini'];

// ---------- petkit request helpers(same as index.js) ----------

// the Petkit login request expects the password to be md5 hashed
function md5Hex(str) {
    return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

// python float format, e.g. 8 -> '8.0', 5.5 -> '5.5'
function pyFloat(num) {
    return (Number.isInteger(num) ? (num + '.0') : String(num));
}

// python string literal format, e.g. abc -> "'abc'"
function pyStr(str) {
    return "'" + String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// python dict repr format, e.g. {locale: 'en-US', version: '13.2.1'}
function pyDictRepr(obj) {
    return '{' + Object.keys(obj).map(key => {
        return key + ': ' + pyStr(obj[key]);
    }).join(', ') + '}';
}

// get the utc offset hours of the given iana timezone, e.g. 8.0
function getTimezoneOffsetHours(timezone, at = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            'timeZone': timezone,
            'timeZoneName': 'shortOffset',
        }).formatToParts(at);
        const offsetPart = parts.find(part => part.type === 'timeZoneName');
        const offsetStr = (offsetPart ? offsetPart.value : 'GMT+0') || 'GMT+0';
        const matches = /GMT([+-]?\d{1,2})(?::(\d{2}))?/.exec(offsetStr);
        if (!matches) return '0.0';
        const hours = Number(matches[1]);
        const minutes = (matches[2] ? Number(matches[2]) / 60 : 0);
        return pyFloat(hours + (hours < 0 ? -minutes : minutes));
    } catch (error) {
        return '0.0';
    }
}

// build the `client` field of the Petkit login request, which is the
// client info the official Petkit app sends
function buildAccountClientInfo(timezone) {
    const clientInfo = Object.assign({}, ACCOUNT_CLIENT, {
        'timezoneId': timezone,
        'timezone': getTimezoneOffsetHours(timezone),
    });
    return pyDictRepr(clientInfo);
}

// normalize device type from server to the plugin's support_device_type
// format, e.g. feedermini -> FeederMini, feeder -> Feeder
function normalizeDeviceType(deviceType) {
    if (!deviceType) {
        return undefined;
    }
    const lower_type = String(deviceType).toLowerCase();
    if (lower_type === 'feedermini') return 'FeederMini';
    if (lower_type === 'feeder') return 'Feeder';
    return deviceType;
}

function getDataString() {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return '' + date.getFullYear() + month + day;
}

// simple http request with network retry, returns the response data
async function httpRequest(options, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.request(options);
            return response.data;
        } catch (error) {
            if (attempt >= retries) {
                throw new Error('Unable to connect to the Petkit server. 无法连接 Petkit 服务器：' + (error.message || error));
            }
        }
    }
}

// parse the petkit error envelope, returns {code, msg} or undefined
function parseErrorEnvelope(jsonObj) {
    if (!jsonObj || !jsonObj.error) {
        return undefined;
    }
    if (typeof jsonObj.error === 'object') {
        return {'code': jsonObj.error.code, 'msg': jsonObj.error.msg || ''};
    }
    return {'code': undefined, 'msg': String(jsonObj.error)};
}

// normalize the server address provided by the settings page, returns the
// base url ending with '/' or undefined when the address is invalid.
function normalizeServerUrl(server) {
    const str = String(server || '').trim();
    if (!/^https?:\/\/.+/i.test(str)) {
        return undefined;
    }
    return (str.endsWith('/') ? str : str + '/');
}

// get the default server address of the given country code, returns undefined
// when the country code is unknown.
function defaultServerForRegion(region) {
    const code = String(region || '').trim().toUpperCase();
    return REGION_SERVERS[code];
}

// login Petkit server with account, if success return {ok: true, sessionId}
// or failed return {ok: false, code, msg}.
async function petkitLogin(server, region, timezone, username, password) {
    const headers = Object.assign({}, ACCOUNT_HEADERS, {
        'X-TimezoneId': timezone,
        'X-Timezone': getTimezoneOffsetHours(timezone),
    });
    const data = querystring.stringify({
        'client': buildAccountClientInfo(timezone),
        'encrypt': '1',
        'region': region,
        'username': username,
        'password': md5Hex(password),
        'oldVersion': ACCOUNT_CLIENT.version,
    });
    const reply = await httpRequest({
        'url': server + 'user/login',
        'method': 'POST',
        'headers': headers,
        'responseType': 'json',
        'timeout': 10000,
        'data': data,
    });

    const errorInfo = parseErrorEnvelope(reply);
    if (errorInfo) {
        return {'ok': false, 'code': errorInfo.code, 'msg': errorInfo.msg};
    }
    if (reply && reply.result && reply.result.session && reply.result.session.id) {
        return {'ok': true, 'sessionId': reply.result.session.id};
    }
    return {'ok': false, 'msg': 'Unable to parse the login reply. 无法解析登录返回信息。'};
}

// fetch the family list(also known as group list) of this account, which
// contains the group id and the device list of each family.
async function petkitGetFamilies(server, sessionId) {
    const headers = Object.assign({}, ACCOUNT_HEADERS, {
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Timezone': '8.0',
        'X-Session': sessionId,
        'F-Session': sessionId,
    });
    const reply = await httpRequest({
        'url': server + 'group/family/list',
        'method': 'GET',
        'headers': headers,
        'responseType': 'json',
        'timeout': 10000,
    });

    const errorInfo = parseErrorEnvelope(reply);
    if (errorInfo) {
        throw new RequestError(friendlyLoginError(errorInfo.code, errorInfo.msg), {'code': errorInfo.code});
    }
    if (!reply || !Array.isArray(reply.result)) {
        throw new RequestError('Unable to parse the device list reply. 无法解析设备列表返回信息。', {'code': 'INVALID_REPLY'});
    }
    return reply.result;
}

// fetch devices shared with this account from the device roster v2 endpoint
async function petkitGetSharedDevices(server, sessionId, groupId) {
    const headers = Object.assign({}, ACCOUNT_HEADERS, {
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Timezone': '8.0',
        'X-Session': sessionId,
        'F-Session': sessionId,
    });
    const reply = await httpRequest({
        'url': server + 'discovery/device_roster_v2',
        'method': 'POST',
        'headers': headers,
        'responseType': 'json',
        'timeout': 10000,
        'data': querystring.stringify({
            'day': getDataString(),
            'groupId': groupId,
        }),
    });

    const errorInfo = parseErrorEnvelope(reply);
    if (errorInfo) {
        throw new RequestError(friendlyLoginError(errorInfo.code, errorInfo.msg), {'code': errorInfo.code});
    }
    if (!reply || !reply.result || !Array.isArray(reply.result.devices)) {
        return [];
    }
    return reply.result.devices;
}

// fetch the name of a device from its device detail endpoint, the device
// roster v2 reply does not include device names. returns undefined when the
// name is unavailable.
async function petkitGetDeviceName(server, sessionId, type, deviceId) {
    const headers = Object.assign({}, ACCOUNT_HEADERS, {
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Timezone': '8.0',
        'X-Session': sessionId,
        'F-Session': sessionId,
    });
    try {
        const reply = await httpRequest({
            'url': server + type.toLowerCase() + '/device_detail?id=' + deviceId,
            'method': 'GET',
            'headers': headers,
            'responseType': 'json',
            'timeout': 10000,
        });

        const errorInfo = parseErrorEnvelope(reply);
        if (errorInfo || !reply || !reply.result || !reply.result.name) {
            return undefined;
        }
        return String(reply.result.name);
    } catch (error) {
        return undefined;
    }
}

// fetch all the devices(owned and shared) of this account, return the
// supported feeder devices only: [{id, name, type}]
async function petkitGetAllDevices(server, sessionId) {
    const families = await petkitGetFamilies(server, sessionId);

    const devices = [];
    for (const family of families) {
        const groupId = (family.groupId !== undefined ? family.groupId : family.group_id);
        const familyDevices = family.deviceList || family.device_list || [];
        for (const device of familyDevices) {
            const type = normalizeDeviceType(device.deviceType || device.device_type);
            if (SUPPORT_DEVICE_TYPE.indexOf(type) === -1) {
                continue;
            }
            devices.push({
                'id': String(device.deviceId !== undefined ? device.deviceId : device.device_id),
                'name': device.deviceName || device.device_name || type,
                'type': type,
            });
        }
        if (familyDevices.length === 0) {
            // no owned device in this family, fetch the shared devices
            const sharedDevices = await petkitGetSharedDevices(server, sessionId, groupId);
            for (const device of sharedDevices) {
                const type = normalizeDeviceType(device.type);
                if (SUPPORT_DEVICE_TYPE.indexOf(type) === -1) {
                    continue;
                }
                const id = String(device.id);
                // the device roster v2 reply does not include device names,
                // fetch the real name from the device detail endpoint and
                // fall back to the type + id string when it is unavailable.
                const detailName = await petkitGetDeviceName(server, sessionId, type, id);
                devices.push({
                    'id': id,
                    'name': detailName || device.deviceTypeAndId || type,
                    'type': type,
                });
            }
        }
    }
    return devices;
}

// friendly login error message shown to the user in the settings page
function friendlyLoginError(code, msg) {
    const CODE_MESSAGES = {
        5: 'Session expired, please log in again. 会话已失效，请重新登录。',
        122: 'Wrong username or password, please check and try again. 账号或密码错误，请检查后重试。',
        125: 'This account is not registered, please check the username. 该账号未注册，请检查账号是否正确。',
    };
    const base = CODE_MESSAGES[code] || 'Login failed. 登录失败。';
    return format('{0} (Server / 服务器返回: code={1}, msg={2})', base, (code !== undefined ? code : '?'), (msg || ''));
}

function format(template) {
    const args = Array.prototype.slice.call(arguments, 1);
    return template.replace(/\{(\d+)?\}/g, (match, index) => {
        return (index === undefined || index === '') ? String(args.shift()) : String(args[Number(index)]);
    });
}

// ---------- custom ui server ----------

class PetkitFeederUiServer extends HomebridgePluginUiServer {
    constructor() {
        // super must be called first
        super();

        // register the api endpoint request handlers
        this.onRequest('/test-login', this.handleTestLogin.bind(this));

        // this.ready() must be called to let the UI know you are ready to accept api calls
        this.ready();
    }

    /**
     * handle the "test login" request from the settings page:
     * 1. login the Petkit server with the account provided by the user;
     * 2. on success, fetch all the devices of this account;
     * returns {sessionId, devices: [{id, name, type}]} or throws a RequestError
     * with a user friendly message when the login fails.
     */
    async handleTestLogin(payload) {
        payload = payload || {};
        const region = String(payload.region || '').trim().toUpperCase();
        // the server address defaults to the official server of the country
        // code, users can also input a custom server address to override it.
        const server = normalizeServerUrl(payload.server) || defaultServerForRegion(region);
        const timezone = payload.timezone || 'Asia/Shanghai';
        const username = String(payload.username || '').trim();
        const password = payload.password || '';

        if (!server) {
            throw new RequestError('Please select a valid server address. 请选择有效的服务器地址。', {'code': 'INVALID_SERVER'});
        }
        if (!username || !password) {
            throw new RequestError('Please enter your Petkit account username and password. 请输入 Petkit 账号和密码。', {'code': 'MISSING_CREDENTIALS'});
        }

        const loginResult = await petkitLogin(server, region, timezone, username, password);
        if (!loginResult.ok) {
            throw new RequestError(friendlyLoginError(loginResult.code, loginResult.msg), {'code': loginResult.code});
        }

        const devices = await petkitGetAllDevices(server, loginResult.sessionId);
        return {
            'sessionId': loginResult.sessionId,
            'devices': devices,
        };
    }
}

// start the instance of the class
(() => {
    return new PetkitFeederUiServer();
})();
