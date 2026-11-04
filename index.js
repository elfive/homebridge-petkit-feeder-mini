'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const crypto = require('crypto');
const format = require('string-format');
const axios = require('axios');
const dayjs = require('dayjs');
const pollingtoevent = require('polling-to-event');

const logUtil = require('./utils/log');
const configUtil = require('./utils/config');
// petkit country code -> default server address mapping, generated from the
// official petkit region servers endpoint, shared with the settings page.
const regionServers = require('./homebridge-ui/public/region-servers.js').servers;

const pluginName = 'homebridge-petkit-feeder-mini';
const platformName = 'petkit_feeder_mini';

const globalVariables = Object.freeze({
    'support_device_type': [                // valid petkit feeder device type
        'Feeder',                           // Petkit Feeder Element
        'FeederMini'                        // Petkit Feeder Mini
    ],
    'support_settings': {
        'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
        'lightMode' : 'settings.lightMode',
    },
    'default_headers': {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'X-Timezone': '8.0',
        'Accept-Language': 'zh-Hans-CN;q=1, en-CN;q=0.9, zh-Hant-CN;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'X-Api-Version': '10.8.1',
        'X-Client': 'ios(18.7.7;iPhone13,4)',
        'X-Hour': '24',
        'User-Agent': 'PetKit/10.8.1 (iPhone; iOS 18.7.7; Scale/3.00)',
        'X-TimezoneId': 'Asia/Shanghai',
        'X-Img-Version': '1',
        'X-Locale': 'zh-CN'
    },
    'default_http_options': {
        'method': 'POST',
        'timeout': 5000,
        'responseType': 'json',
        'retry' : {
            'enabled': true,
            'max_retry': 3,                 // http request retry count
        }
    },
    // default http headers used by account login mode, these are the exact
    // headers the current official Petkit app(android) sends, which has been
    // verified working with the login and device endpoints on all servers.
    'account_headers': {
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
    },
    // client info sent to the Petkit login request, see
    // https://github.com/Jezza34000/py-petkit-api for more detail.
    'account_client': {
        'locale': 'en-US',
        'name': '23127PN0CG',
        'osVersion': '16.1',
        'phoneBrand': 'Xiaomi',
        'platform': 'android',
        'source': 'app.petkit-android',
        'version': '13.2.1',
    },
    // device endpoint templates relative to the server address, the server
    // address is configurable in the settings page(see the `server` config
    // item) and the full url is `server` + template.
    'device_urls': {
        'Feeder': {
            'deviceState': 'feeder/devicestate?id={}',
            'deviceDetailInfo': 'feeder/device_detail?id={}',
            'saveDailyFeed': 'feeder/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
            'removeDailyFeed': 'feeder/remove_dailyfeed?deviceId={}&day={}&id=d{}',
            'dailyfeeds': 'feeder/dailyfeeds?deviceId={}&days={}',
            'restoreDailyFeeds': 'feeder/restore_dailyfeed?deviceId={}&day={}&id=s{}',
            'disableDailyFeeds': 'feeder/remove_dailyfeed?deviceId={}&day={}&id=s{}',
            'resetDesiccant': 'feeder/desiccant_reset?deviceId={}',
            'updateSettings': 'feeder/update?id={}&kv={}',
        },
        'FeederMini': {
            'deviceState': 'feedermini/devicestate?id={}',
            'deviceDetailInfo': 'feedermini/device_detail?id={}',
            'saveDailyFeed': 'feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
            'removeDailyFeed': 'feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
            'dailyfeeds': 'feedermini/dailyfeeds?deviceId={}&days={}',
            'restoreDailyFeeds': 'feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
            'disableDailyFeeds': 'feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
            'resetDesiccant': 'feedermini/desiccant_reset?deviceId={}',
            'updateSettings': 'feedermini/update?id={}&kv={}',
        }
    },
    'config': {
        'min_amount': 0,                    // in meal(same in app)
        'max_amount': 10,                   // in meal(same in app)
        'min_desiccantLeftDays': 0,         // in day
        'max_desiccantLeftDays': 30,        // in day
        'min_batteryLevel': 0,              // level(same in app)
        'max_batteryLevel': 4,              // level(same in app)
        'batteryPersentPerLevel': 100 / 4,
        'min_pollint_interval': 60,         // in second
        'max_pollint_interval': 3600,       // in second
        'min_fetch_status_interval': 10,    // in second
        'foodStorage_alerm_threshold': 300,
    }
});

class PetkitFeederDevice {
    constructor() {
        let accessory = undefined;
        this.config = undefined;
        this.events = {
            'polling_event': undefined
        }
        this.services = {
            'drop_meal_service': undefined,
            'meal_amount_service': undefined,
            'food_storage_service': undefined,
            'desiccant_level_service': undefined,
            'lightMode_service': undefined,
            'battery_status_service': undefined,
            'info_service': undefined
        };
        this.status = {     // petkit status value
            'lastUpdate': 0,
            'food' : 0,                 // this.config.get('reverse_foodStorage_indicator') ? !petkitDevice.status.food : petkitDevice.status.food
            'batteryPower': 0,  
            'batteryStatus': 1,
            'desiccantLeftDays' : 0,    // petkitDevice.status.desiccantLeftDays < petkitDevice.config.get('alert_desiccant_threshold') ? 1 : 0
            'manualLock': 0,
            'lightMode': 0,
            'meals': {}
        };
        this.savedData = {
            'mealAmount': 2,
        };

        Object.defineProperty(this, 'accessory', {
            get() {
                return accessory;
            },
            set(value) {
                accessory = value;
                this.load();
            }
        });

        this.load();
    }

    save() {
        if (this.accessory && this.savedData) {
            this.accessory.context = this.savedData;
        }
    }

    load() {
        if (this.accessory && this.accessory.context) {
            this.savedData = Object.assign(this.savedData, this.accessory.context);
        }
    }

    getFoodStatusForHomebridge() {
        if (this.config.get('model') === 'Feeder') {
            if (this.config.get('reverse_foodStorage_indicator')) {
                return (this.status.food < globalVariables.config.foodStorage_alerm_threshold ? 1 : 0);
            } else {
                return (this.status.food < globalVariables.config.foodStorage_alerm_threshold ? 0 : 1);
            }
        } else if (this.config.get('model') === 'FeederMini') {
            if (this.config.get('reverse_foodStorage_indicator')) {
                return (this.status.food != 1);
            } else {
                return (this.status.food == 1);
            }
        } else {
            return 0;
        }
    }
};

function getTimestamp() {
    return Math.floor(Date.now() / 1000);
};

function getDataString() {
    return dayjs(new Date()).format('YYYYMMDD');
}

class petkit_feeder_plugin {
    constructor(log, config, api) {
        this.log = new logUtil(log, config.log_level || logUtil.LOGLV_INFO);
        this.log.info('begin to initialize Petkit Feeder Platform.');
        this.config = config;

        if (!api) {
            this.log.error("Homebridge's version is too old, please upgrade!");
            return;
        }
        this.api = api;
        this.accessories = new Map();
        this.accounts = new Map();      // petkit account session cache, key: server|username

        if (!config) {
            this.log.error("no configure found for Petkit Feeder Platform.");
            this.log.error("double check your config.json.");
            return;
        }

        // check and modify the platform configure value
        this.platformConf = this.configCheck(config);
        if (!this.platformConf) {
            return;
        }

        // When this event is fired, homebridge restored all cached accessories from disk and did call their respective
        // `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
        // after this event was fired, in order to ensure they weren't added to homebridge already.
        // This event can also be used to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            this.initializePlatform();
        });
        this.log.info('Petkit Feeder Platform loaded.');
    }

    // check and modify configure value
    // @prama config: config Object from config.json
    // @return: if success return instance of configUtil or failed return undefined;
    configCheck(config) {
        const fulfill_headerset = (headers, key, value) => {
            let header = headers.find(header => header.key == key);
            if (undefined === header) {
                this.log.debug(format('missing header: {0}, using \'{1}\' instead.', key, value));
                headers.push({'key': key, 'value': value});
            } else if ('' === header) {
                this.log.warn(format('header \'{0}\' value is empty, using \'{1}\' instead.', key, value));
                headers.push({'key': key, 'value': value});
            }
        };

        // work on a copy of the raw config, so the config object provided
        // by homebridge is never mutated by this plugin.
        const conf = new configUtil(Object.assign({}, config));

        // region(country code) is the primary setting now, the server address
        // defaults to the official server of the country code automatically.
        let region = String(conf.fulfill('region', 'CN') || '').trim().toUpperCase();
        conf.set('region', region);

        // server address, the base url of the Petkit api. when it is not
        // configured, the default server of the region is used instead, users
        // can also choose one of the known servers or input a custom one in
        // the settings page.
        let server = conf.get('server');
        if (!server || !String(server).trim()) {
            server = regionServers[region];
            if (!server) {
                this.log.error(format('unable to find the default server address of region({}), and no server address found in your config.', region));
                this.log.error('you may provide the server address of your Petkit account, e.g. https://api.petkit.cn/6/');
                return undefined;
            }
            this.log.debug(format('server address not configured, using the default server({0}) of region({1}).', server, region));
        }
        server = String(server).trim();
        if (!/^https?:\/\/.+/i.test(server)) {
            this.log.error(format('value of server({0}) should be a valid http(s) address.', server));
            return undefined;
        }
        if (!server.endsWith('/')) {
            server += '/';
        }
        conf.set('server', server);

        // the account urls are derived from the server address
        conf.set('account_urls', {
            'login': server + 'user/login',
            'familyList': server + 'group/family/list',
            'deviceRosterV2': server + 'discovery/device_roster_v2',
        });

        // login mode:
        //   - 'account': login Petkit server with username/password, and fetch
        //     the session(formerly the X-Session header captured by user) from
        //     server automatically.
        //   - 'headers': legacy mode, use the http request headers(include
        //     X-Session) captured from Petkit app by user.
        let config_headers = conf.get('headers');
        if (config_headers) {
            // copy the headers array so the caller's config is never mutated
            config_headers = config_headers.slice();
        }
        const config_username = conf.get('username');
        const config_password = conf.get('password');
        let login_mode = undefined;
        if (config_username && config_password) {
            login_mode = 'account';
            conf.set('login_mode', login_mode);
            this.log.debug('login Petkit server with account, X-Session will be fetched automatically.');
        } else {
            login_mode = 'headers';
            conf.set('login_mode', login_mode);
            if (!config_headers) {
                this.log.error('missing dataset: headers in your config.');
                this.log.error('you may provide the http request headers(include X-Session) captured from Petkit app,');
                this.log.error('or provide username/password to let this plugin login Petkit server for you.');
                return undefined;
            }

            let header_x_session = config_headers.find(header => header.key === 'X-Session');
            if (undefined === header_x_session) {
                this.log.error('missing header in your headers: X-Session(note: case sensitive).');
                return undefined;
            }
        }

        if (!config_headers) config_headers = [];
        const default_headers = (login_mode === 'account') ?
            globalVariables.account_headers :
            globalVariables.default_headers;
        for (const [key, value] of Object.entries(default_headers)) {
            fulfill_headerset(config_headers, key, value);
        }

        // convert header format
        let http_headers = {};
        config_headers.forEach(header => {
            http_headers[header.key] = header.value;
        });

        if (login_mode === 'account') {
            // the timezone defaults to Asia/Shanghai for the login request,
            // it will be replaced by the timezone returned from the server
            // when the device detail is fetched.
            const timezone = conf.fulfill('timezone', 'Asia/Shanghai');
            http_headers['X-TimezoneId'] = timezone;
            http_headers['X-Timezone'] = this.getTimezoneOffsetHours(timezone);
        }
        conf.set('headers', http_headers)

        // optional configure items, these are platform level settings shared
        // by every device found from the Petkit server.
        conf.fulfill('manufacturer', 'Petkit');
        // polling is always enabled
        conf.set('enable_polling', true);

        conf.fulfill('polling_interval', 60);
        const polling_interval = conf.get('polling_interval');
        const min_polling_interval = globalVariables.config.min_pollint_interval;
        const max_polling_interval = globalVariables.config.max_pollint_interval;
        if (polling_interval < min_polling_interval) {
            this.log.warn(format('value of polling_interval({0}) should great than {1}, now using {1} instead', polling_interval, min_polling_interval));
            conf.set('polling_interval', min_polling_interval);
        } else if (polling_interval > max_polling_interval) {
            this.log.warn(format('value of polling_interval({0}) should smaller than {1}, now using {1} instead', polling_interval, max_polling_interval));
            conf.set('polling_interval', max_polling_interval);
        }

        conf.fulfill('enable_manualLock', false);
        conf.fulfill('enable_lightMode', false);
        conf.fulfill('reverse_foodStorage_indicator', false);
        conf.fulfill('fast_response', false);

        // service name field
        conf.fulfill('DropMeal_name', 'DropMeal');
        conf.fulfill('MealAmount_name', 'MealAmount');
        conf.fulfill('FoodStorage_name', (conf.get('reverse_foodStorage_indicator') ? 'FoodStorage_Empty' : 'FoodStorage'));
        conf.fulfill('DesiccantLevel_name', 'DesiccantLevel');
        conf.fulfill('ManualLock_name', 'ManualLock');
        conf.fulfill('LightMode_name', 'LightMode');
        conf.fulfill('Battery_name', 'Battery');

        // print config log(note: password has been redacted)
        conf.print(content => {this.log.debug(this.redactPassword(content))});

        return conf;
    }

    // redact password in the config log to avoid leaking the account password
    redactPassword(configJsonStr) {
        try {
            const configJsonObj = JSON.parse(configJsonStr);
            if (configJsonObj && configJsonObj.password) {
                configJsonObj.password = '******';
            }
            return JSON.stringify(configJsonObj);
        } catch (error) {
            // not a valid json string, return it unchanged
            return configJsonStr;
        }
    }

    // the Petkit login request expects the password to be md5 hashed
    md5Hex(str) {
        return crypto.createHash('md5').update(str, 'utf8').digest('hex');
    }

    // python float format, e.g. 8 -> '8.0', 5.5 -> '5.5'
    pyFloat(num) {
        return (Number.isInteger(num) ? (num + '.0') : String(num));
    }

    // python string literal format, e.g. abc -> "'abc'"
    pyStr(str) {
        return "'" + String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    }

    // python dict repr format, e.g. {locale: 'en-US', version: '13.2.1'}
    pyDictRepr(obj) {
        return '{' + Object.keys(obj).map(key => {
            return key + ': ' + this.pyStr(obj[key]);
        }).join(', ') + '}';
    }

    // build the `client` field of the Petkit login request, which is the
    // client info the official Petkit app sends
    buildAccountClientInfo(timezone) {
        const clientInfo = Object.assign({}, globalVariables.account_client, {
            'timezoneId': timezone,
            'timezone': this.getTimezoneOffsetHours(timezone),
        });
        return this.pyDictRepr(clientInfo);
    }

    // get the utc offset hours of the given iana timezone, e.g. 8.0
    getTimezoneOffsetHours(timezone, at = new Date()) {
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
            return this.pyFloat(hours + (hours < 0 ? -minutes : minutes));
        } catch (error) {
            return '0.0';
        }
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    // This function is invoked when homebridge restores cached accessories from disk at startup.
    // It should be used to setup event handlers for characteristics and update respective values.
    configureAccessory(accessory) {
        const petkitDevice = Object.assign(new PetkitFeederDevice(), {
            'accessory': accessory,
        });
        this.accessories.set(accessory.UUID, petkitDevice);
    }

    // setup accessory's service include handlers,value
    // @return: if success return true or failed return false;
    setupAccessory(petkitDevice) {
        let accessory = petkitDevice.accessory;
        let config = petkitDevice.config;  // instance of configUtil
        let service_name = undefined;
        let service_status = undefined;

        // each service below is identified by its stable role subtype, not by
        // its display name: display names are user editable(and shared by
        // every device), so a service renamed in the settings page or created
        // by an older plugin version is found again after a homebridge
        // restart and renamed in place, instead of keeping the old name or
        // being added twice.
        //
        // after the service is found or created, its display name, subtype
        // and the Name characteristic are always applied explicitly, because
        // how `addService` passes its constructor arguments differs between
        // hap-nodejs versions: older versions force the accessory display
        // name on every new service, which made every service show the
        // accessory name(智能喂食器) in HomeKit no matter what name was
        // configured in the settings page.
        const role_subtypes = ['DropMeal', 'MealAmount', 'FoodStorage', 'DesiccantLevel', 'ManualLock', 'LightMode', 'Battery'];
        const claimed_services = new Set();
        const findOrCreateRoleService = (service_type, role_subtype, name) => {
            const services = (accessory.services || []);
            // 1. a service of this role created by this plugin version or
            // newer, matched by its stable role subtype
            let service = services.find(item =>
                item && (item.UUID === service_type.UUID) && (item.subtype === role_subtype) &&
                !claimed_services.has(item));
            if (!service) {
                // 2. a service created by an older plugin version has no role
                // subtype, adopt the first unclaimed service of the same type
                // instead(the services keep their creation order, which
                // matches the order of the roles below). a service whose
                // subtype already belongs to another role is left alone: it
                // belongs to a role disabled in the config.
                service = services.find(item =>
                    item && (item.UUID === service_type.UUID) && !claimed_services.has(item) &&
                    (item.subtype === undefined || role_subtypes.indexOf(item.subtype) === -1));
            }
            if (!service) {
                // 3. no service of this role exists, create one. the display
                // name is applied explicitly below, so it never falls back to
                // the accessory display name.
                service = accessory.addService(service_type, (name || role_subtype), role_subtype);
                if (!service) {
                    this.log.error('petkit device service create failed: ' + (name || role_subtype));
                    return undefined;
                }
            }
            claimed_services.add(service);

            // always re-apply the configured name on the found or created
            // service, so a config change(or a cached service created by an
            // older plugin version) is picked up after a homebridge restart.
            const display_name = (name || role_subtype);
            service.displayName = display_name;
            // restore the stable role subtype as well, since some hap-nodejs
            // versions pass the display name as the subtype argument.
            service.subtype = role_subtype;
            let name_characteristic = undefined;
            try {
                name_characteristic = service.getCharacteristic(Characteristic.Name);
            } catch (error) {
                // some hap-nodejs versions throw instead of returning
                // undefined when the characteristic is not on the service.
            }
            if (!name_characteristic) {
                name_characteristic = service.addCharacteristic(Characteristic.Name);
            }
            name_characteristic.updateValue(display_name);
            // also expose the configured name through the ConfiguredName
            // characteristic: the Home app uses it as the name assigned to
            // each service when the accessory is paired. without it, every
            // sub-accessory of this accessory is initially named after the
            // accessory itself(智能喂食器) instead of the configured name,
            // even though the Name characteristic holds the right value(the
            // configured name then only shows up as the rename placeholder
            // in the Home app).
            try {
                if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
                    service.addOptionalCharacteristic(Characteristic.ConfiguredName);
                }
                service.getCharacteristic(Characteristic.ConfiguredName).updateValue(display_name);
            } catch (error) {
                // older hap-nodejs versions may not expose ConfiguredName
            }
            return service;
        };

        // setup meal drop service
        if (true) {
            service_name = config.get('DropMeal_name');
            let drop_meal_service = findOrCreateRoleService(Service.Switch, 'DropMeal', service_name);
            if (!drop_meal_service) {
                return false;
            }
            drop_meal_service.setPrimaryService(true);
            drop_meal_service.getCharacteristic(Characteristic.On)
                .on('get', callback => callback(null, 0))
                .on('set', this.hb_dropMeal_set.bind(this, petkitDevice));

            petkitDevice.services.drop_meal_service = drop_meal_service;
        }

        // setup meal amount service
        if (true) {
            service_name = config.get('MealAmount_name');
            let meal_amount_service = findOrCreateRoleService(Service.Fan, 'MealAmount', service_name);
            if (!meal_amount_service) {
                return false;
            }

            meal_amount_service.getCharacteristic(Characteristic.On)
                .on('get', callback => callback(null, petkitDevice.savedData.mealAmount !== 0));
            meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
                .on('get', callback => callback(null, petkitDevice.savedData.mealAmount))
                .on('set', this.hb_mealAmount_set.bind(this, petkitDevice))
                .setProps({
                    minValue: globalVariables.config.min_amount,
                    maxValue: globalVariables.config.max_amount,
                    minStep: 1
                });

            petkitDevice.services.meal_amount_service = meal_amount_service;
        }

        // setup food storage indicator service
        if (true) {
            service_name = config.get('FoodStorage_name');
            let food_storage_service = findOrCreateRoleService(Service.OccupancySensor, 'FoodStorage', service_name);
            if (!food_storage_service) {
                return false;
            }

            service_status = petkitDevice.getFoodStatusForHomebridge();
            food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, service_status)
            food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', this.hb_foodStorageStatus_get.bind(this, petkitDevice));

            petkitDevice.services.food_storage_service = food_storage_service;
        }

        // setup desiccant left days service
        if (config.get('enable_desiccant')) {
            service_name = config.get('DesiccantLevel_name');
            let desiccant_level_service = findOrCreateRoleService(Service.FilterMaintenance, 'DesiccantLevel', service_name);
            if (!desiccant_level_service) {
                return false;
            }

            desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication,
                (petkitDevice.status.desiccantLeftDays < config.get('alert_desiccant_threshold') ? 1 : 0));
            desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
                .on('get', this.hb_desiccantIndicator_get.bind(this, petkitDevice));

            desiccant_level_service.setCharacteristic(Characteristic.FilterLifeLevel, petkitDevice.status.desiccantLeftDays);
            desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
                .on('get', this.hb_desiccantLeftDays_get.bind(this, petkitDevice))
                .setProps({
                    minValue: globalVariables.config.min_desiccantLeftDays,
                    maxValue: globalVariables.config.max_desiccantLeftDays,
                    minStep: 1
                });

            desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
                .on('set', this.hb_desiccantLeftDays_reset.bind(this, petkitDevice));

            petkitDevice.services.desiccant_level_service = desiccant_level_service;
        }

        // setup manualLock setting service
        if (config.get('enable_manualLock')) {
            service_name = config.get('ManualLock_name');
            let manualLock_service = findOrCreateRoleService(Service.Switch, 'ManualLock', service_name);
            if (!manualLock_service) {
                return false;
            }

            manualLock_service.setCharacteristic(Characteristic.On, petkitDevice.status.manualLock);
            manualLock_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this, petkitDevice))
                .on('set', this.hb_manualLockStatus_set.bind(this, petkitDevice));

            petkitDevice.services.manualLock_service = manualLock_service;
        }

        // setup lightMode setting service
        if (config.get('enable_lightMode')) {
            service_name = config.get('LightMode_name');
            let lightMode_service = findOrCreateRoleService(Service.Switch, 'LightMode', service_name);
            if (!lightMode_service) {
                return false;
            }

            lightMode_service.setCharacteristic(Characteristic.On, petkitDevice.status.lightMode);
            lightMode_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_lightModeStatus_get.bind(this, petkitDevice))
                .on('set', this.hb_lightModeStatus_set.bind(this, petkitDevice));

            petkitDevice.services.lightMode_service = lightMode_service;
        }

        // setup battery status service, only for Petkit Feeder Mini
        if (petkitDevice.config.get('model') === 'FeederMini') {
            service_name = config.get('Battery_name');
            let battery_status_service = findOrCreateRoleService(Service.Battery, 'Battery', service_name);
            if (!battery_status_service) {
                return false;
            }

            battery_status_service.setCharacteristic(Characteristic.BatteryLevel, petkitDevice.status.batteryPower);
            battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
                .on('get', this.hb_deviceBatteryLevel_get.bind(this, petkitDevice));

            battery_status_service.setCharacteristic(Characteristic.ChargingState, (petkitDevice.status.batteryStatus == 0 ?
                Characteristic.ChargingState.CHARGING :
                Characteristic.ChargingState.NOT_CHARGING));
            battery_status_service.getCharacteristic(Characteristic.ChargingState)
                .on('get', this.hb_deviceChargingState_get.bind(this, petkitDevice));

            battery_status_service.setCharacteristic(Characteristic.StatusLowBattery, (petkitDevice.status.batteryPower <= 50 ?
                Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
            battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', this.hb_deviceStatusLowBattery_get.bind(this, petkitDevice));

            petkitDevice.services.battery_status_service = battery_status_service;
        }

        // setup divice information service
        if (true) {
            let info_service = accessory.getService(Service.AccessoryInformation);
            if (!info_service) {
                // service not exist, create service
                info_service = accessory.addService(Service.AccessoryInformation);
                if (!info_service) {
                    this.log.error('petkit device service create failed: info_service');
                    return false;
                }
            }

            info_service
                .setCharacteristic(Characteristic.Identify, config.get('deviceId'))
                .setCharacteristic(Characteristic.Manufacturer, config.get('manufacturer'))
                .setCharacteristic(Characteristic.Model, config.get('model'))
                .setCharacteristic(Characteristic.SerialNumber, config.get('sn'))
                // infomation below changed from petkit app require a homebridge reboot to take effect.
                .setCharacteristic(Characteristic.Name, config.get('name'))
                .setCharacteristic(Characteristic.FirmwareRevision, config.get('firmware'));

            petkitDevice.services.info_service = info_service;
        }
        return true;
    }

    // initialize the platform: login the petkit server(if account mode),
    // discover all the supported devices of this account from the server
    // and add an accessory for each of the enabled ones.
    initializePlatform() {
        this.log.info('initializing Petkit Feeder Platform.');
        this.log.debug('request device info from Petkit server.');
        this.ensureAccountReady(this.platformConf)
            .then(ready => {
                return (ready ? this.http_getOwnDevice(this.platformConf) : undefined);
            })
            .then(owned_device_raw => {
                if (!owned_device_raw) {
                    this.log.error('unable to fetch information from petkit server. skip adding petkit device.');
                    return;
                }
                let owned_devices = this.praseGetOwnedDevice(owned_device_raw);
                if (owned_devices === false) {
                    this.log.error('unable to fetch information from petkit server. skip adding petkit device.');
                    return;
                } else if (owned_devices.length === 0) {
                    this.log.error(format('sorry that this plugin only works with these device type:{}.', JSON.stringify(globalVariables.support_device_type)));
                    return;
                }

                // only initialize the devices selected by user in the
                // settings page. when the `devices` config item is absent,
                // every device of this account is initialized.
                // each `devices` entry is either a device id string, or an
                // object like {id: 'xxx', name: 'display name in homekit'}.
                const total_found = owned_devices.length;
                const selected_devices = this.platformConf.get('devices');
                if (selected_devices !== undefined) {
                    const selected = selected_devices.map(entry => {
                        return String((entry && typeof entry === 'object') ? entry.id : entry);
                    });
                    owned_devices.forEach(device => {
                        if (selected.indexOf(String(device.id)) === -1) {
                            this.log.info(format('device({}) is not enabled in config, skip it.', device.name));
                        }
                    });
                    owned_devices = owned_devices.filter(device => selected.indexOf(String(device.id)) !== -1);
                }
                if (owned_devices.length === 0) {
                    this.log.warn('no device is enabled in config, nothing to control.');
                    return;
                }

                this.log.info(format('found {} petkit feeder device(s) from server, {} enabled.', total_found, owned_devices.length));
                owned_devices.forEach(validDevice => {
                    this.initializeDevice(validDevice);
                });
            })
            .catch(error => {
                this.log.error('unable to fetch device information from petkit server: ' + (error.stack ? error.stack : error));
            });
    }

    // get the device name configured by user in the settings page for the
    // given device id, return undefined when not configured, in which case
    // the device name from the Petkit server is used instead.
    getSelectedDeviceName(deviceId) {
        const selected_devices = this.platformConf.get('devices');
        if (!Array.isArray(selected_devices)) {
            return undefined;
        }
        const id = String(deviceId);
        for (const entry of selected_devices) {
            if (entry && typeof entry === 'object' && String(entry.id) === id) {
                return (entry.name ? String(entry.name).trim() : undefined);
            }
        }
        return undefined;
    }

    // initialize one accessory for one device found from the server
    // @param validDevice: {id, name, type} from praseGetOwnedDevice
    initializeDevice(validDevice) {
        const deviceName = this.getSelectedDeviceName(validDevice.id) || validDevice.name;
        const config = this.buildDeviceConf(validDevice, deviceName);
        this.log.info(format('initializing Petkit Feeder device({}) with deviceId: {}.', deviceName, validDevice.id));

        // uuid must be generated from a unique but not changing data source,
        // device id is buildin the device and will never change.
        const uuid = UUIDGen.generate(String(validDevice.id));
        let petkitDevice = this.accessories.get(uuid);
        if (!petkitDevice) {
            // petkitDevice not exists, create petkitDevice and accessory
            // (the third constructor argument is the accessory category, not
            // a name; leave it out to use the default category)
            let accessory = new this.api.platformAccessory(deviceName, uuid);
            if (!accessory) {
                this.log.error('initialize Petkit Feeder failed: could not create accessory');
                return;
            }

            petkitDevice = new PetkitFeederDevice();
            petkitDevice.accessory = accessory;
            petkitDevice.config = config;
        } else if (!petkitDevice.accessory) {
            // accessory not exists, create accessory
            let accessory = new this.api.platformAccessory(deviceName, uuid);
            if (!accessory) {
                this.log.error('initialize Petkit Feeder failed: could not create accessory');
                return;
            }
            petkitDevice.accessory = accessory;
            petkitDevice.config = config;
        } else {
            // accessory exists, update config and display name. homebridge 2.x
            // wraps the HAP accessory in its own PlatformAccessory class,
            // whose displayName must be updated through `updateDisplayName` so
            // the wrapped HAP accessory is kept in sync as well.
            petkitDevice.config = config;
            const cached_accessory = petkitDevice.accessory;
            if (typeof cached_accessory.updateDisplayName === 'function') {
                cached_accessory.updateDisplayName(deviceName);
            } else {
                cached_accessory.displayName = deviceName;
            }
        }

        this.log.debug('request initial device status from Petkit server.');
        this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
            if (deviceDetailInfo) {
                petkitDevice.config.set('sn', deviceDetailInfo.sn);
                petkitDevice.config.set('firmware', deviceDetailInfo.firmware);
                // use the timezone returned by the server instead of the
                // configured one, so no timezone setting is needed any more.
                if (deviceDetailInfo.timezone) {
                    petkitDevice.config.set('timezone', deviceDetailInfo.timezone);
                    this.platformConf.set('timezone', deviceDetailInfo.timezone);
                    petkitDevice.config.assign('headers', {
                        'X-TimezoneId': deviceDetailInfo.timezone,
                        'X-Timezone': this.getTimezoneOffsetHours(deviceDetailInfo.timezone),
                    });
                } else if (deviceDetailInfo.locale) {
                    petkitDevice.config.assign('headers', {'X-TimezoneId': deviceDetailInfo.locale})
                }

                if (this.setupAccessory(petkitDevice)) {
                    // all service setup success, now update accessory
                    if (!this.accessories.get(uuid)) {
                        this.api.registerPlatformAccessories(pluginName, platformName, [petkitDevice.accessory]);
                    }
                    // keep the whole petkitDevice(the config and services
                    // are needed by later status polling), not the bare
                    // accessory object.
                    this.accessories.set(uuid, petkitDevice);

                    this.log.info(format('initialize Petkit Feeder device({}) success.', config.get('name')));

                    // polling
                    this.setupPolling(petkitDevice);
                } else {
                    this.log.error(format('initialize Petkit Feeder device({}) failed.', config.get('name')));
                }
            } else {
                this.log.warn(format('bypass initialize Petkit Feeder device({}).', config.get('name')));
            }
        });
    }

    // build a per device config from the platform config, the device specific
    // value(deviceId, name, model, urls) comes from the server reply, and the
    // name can be overridden by the display name configured by user in the
    // settings page.
    buildDeviceConf(validDevice, name) {
        const conf = new configUtil(Object.assign({}, this.platformConf.config));
        const server = conf.get('server');
        const urls = {};
        for (const [key, template] of Object.entries(globalVariables.device_urls[validDevice.type])) {
            urls[key] = server + template;
        }
        conf.set('deviceId', validDevice.id);
        conf.set('name', (name || validDevice.name));
        conf.set('model', validDevice.type);
        conf.set('urls', urls);
        return conf;
    }

    praseGetOwnedDevice(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseGetOwnedDevice error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your login configure(X-Session header or account username/password).');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.result.hasOwnProperty('devices')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.result.devices.length === 0) {
            this.log.error('seems you didn\'t owned a Petkit Feeder device.');
            return false;
        }

        var valid_devices = [];
        jsonObj.result.devices.forEach(device => {
            const index = globalVariables.support_device_type.indexOf(device.type);
            if (index !== -1 && device.data) {
                valid_devices.push(Object.assign(device.data, {'type': device.type}));
            }
        });
        return valid_devices;
    }

    praseGetDeviceDetailInfo(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseGetDeviceDetailInfo error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your login configure(X-Session header or account username/password).');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result') ||
            !jsonObj.result.hasOwnProperty('state') ||
            !jsonObj.result.hasOwnProperty('settings')) {
            this.log.error('unable to parse device info reply from server with data: ' + jsonStr);
            return false;
        }

        const deviceInfo = jsonObj.result;

        let deviceDetailInfo = {};
        if (deviceInfo.name) deviceDetailInfo.name = deviceInfo.name;
        if (deviceInfo.sn) deviceDetailInfo.sn = deviceInfo.sn;
        if (deviceInfo.firmware) deviceDetailInfo.firmware = deviceInfo.firmware;
        if (deviceInfo.timezone) deviceDetailInfo.timezone = deviceInfo.timezone;
        if (deviceInfo.locale) deviceDetailInfo.locale = deviceInfo.locale;

        deviceDetailInfo.status = {};
        // 1 for status ok, 0 for empty
        if (deviceInfo.state.food !== undefined) deviceDetailInfo.status.food = deviceInfo.state.food;
        // this.log.debug('device food storage status is: ' + (deviceDetailInfo.status.food ? 'Ok' : 'Empty'));

        if (deviceInfo.state.batteryPower !== undefined) deviceDetailInfo.status.batteryPower = deviceInfo.state.batteryPower;
        // this.log.debug('device battery level is: ' + deviceDetailInfo.status.batteryPower * globalVariables.config.batteryPersentPerLevel);

        // 0 for charging mode, 1 for battery mode
        if (deviceInfo.state.batteryStatus !== undefined) deviceDetailInfo.status.batteryStatus = deviceInfo.state.batteryStatus;
        // this.log.debug('device battery status is: ' + (deviceDetailInfo.status.batteryStatus ? 'charging mode' : 'battery mode'));

        if (deviceInfo.state.desiccantLeftDays !== undefined) deviceDetailInfo.status.desiccantLeftDays = deviceInfo.state.desiccantLeftDays;
        // this.log.debug('device desiccant remain: ' + (deviceDetailInfo.status.desiccantLeftDays + ' day(s)'));
        
        // 0 for unlocked, 1 for locked
        if (deviceInfo.settings.manualLock !== undefined) deviceDetailInfo.status.manualLock = deviceInfo.settings.manualLock;
        // this.log.debug('device manual lock status is: ' + (deviceDetailInfo.status.manualLock ? 'unlocked' : 'locked'));

        // 0 for light off, 1 for lignt on
        if (deviceInfo.settings.lightMode !== undefined) deviceDetailInfo.status.lightMode = deviceInfo.settings.lightMode;
        // this.log.debug('device light status is: ' + (deviceDetailInfo.status.lightMode ? 'on' : 'off'));

        return deviceDetailInfo;
    }

    praseUpdateDeviceSettingsResult(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseUpdateDeviceSettingsResult error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your login configure(X-Session header or account username/password).');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        return (jsonObj.result === 'success');
    }

    praseSaveDailyFeedResult(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseSaveDailyFeedResult error: jsonObj is nothing.');
            return false;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error')) {
            this.log.error('server reply an error: ' + jsonStr);
            this.log.error('you may need to check your login configure(X-Session header or account username/password).');
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.error('JSON.parse error with:' + jsonStr);
            return false;
        }

        return (jsonObj.result.isExecuted === 1);
    }

    // ------------------------------------------------
    // account login mode
    // login Petkit server with username/password like the Petkit app does,
    // fetch the session(formerly the X-Session header captured by user) and
    // other information(like group id) from server automatically, and persist
    // the session so that it can be reused after homebridge restarts.
    // ------------------------------------------------

    getAccountKey(server, username) {
        return format('{}|{}', server, username);
    }

    registerAccount(conf) {
        const key = this.getAccountKey(conf.get('server'), conf.get('username'));
        let account = this.accounts.get(key);
        if (!account) {
            account = {
                'server': conf.get('server'),
                'username': conf.get('username'),
                'confs': new Set(),
                'sessionId': undefined,
                'loginPromise': undefined,
                'lastLoginResult': undefined,
            };
            this.accounts.set(key, account);
        }
        account.confs.add(conf);
        if (account.sessionId) {
            // login already finished before this device registered, share the session
            conf.assign('headers', {'X-Session': account.sessionId, 'F-Session': account.sessionId});
        }
        return account;
    }

    // make sure this petkit account session is usable before any other request
    // to the Petkit server. return true if success or failed return false.
    async ensureAccountReady(conf) {
        if (conf.get('login_mode') !== 'account') {
            return true;
        }
        const account = this.registerAccount(conf);
        const ready = await this.ensureAccountSession(account, false);
        if (!ready) {
            this.log.error(format('unable to login Petkit server with account: {}, skip adding this petkit device.', account.username));
        }
        return ready;
    }

    // ensure account session is valid. when forceLogin is true, always login
    // Petkit server again to refresh the session.
    // note: login requests of the same account are serialized here, because
    // Petkit server only allows one active session per account, concurrent
    // logins would invalidate each other.
    async ensureAccountSession(account, forceLogin = false) {
        const current = account.loginPromise;
        if (current) {
            await current.catch(() => undefined);
            if (!forceLogin) {
                return account.lastLoginResult;
            }
        }
        const promise = this.doEnsureAccountSession(account, forceLogin)
            .then(result => {
                account.lastLoginResult = result;
                return result;
            })
            .finally(() => {
                if (account.loginPromise === promise) {
                    account.loginPromise = undefined;
                }
            });
        account.loginPromise = promise;
        return promise;
    }

    async doEnsureAccountSession(account, forceLogin) {
        const probe = account.confs.values().next().value;

        if (!forceLogin) {
            // try to reuse the persisted session first. note: the session is
            // not validated here, the first real request to the Petkit server
            // will trigger a re-login automatically if it is expired.
            const storedSession = this.loadPersistedSession(account);
            if (storedSession && storedSession.sessionId) {
                account.confs.forEach(conf => {
                    conf.assign('headers', {'X-Session': storedSession.sessionId, 'F-Session': storedSession.sessionId});
                });
                account.sessionId = storedSession.sessionId;
                this.log.info(format('Petkit account({}) session reused from cache(login at: {}).', account.username, storedSession.loginAt));
                return true;
            }
        }

        const sessionId = await this.petkitLogin(probe);
        if (!sessionId) {
            this.log.error(format('Petkit account({}) login failed.', account.username));
            return false;
        }
        account.confs.forEach(conf => {
            conf.assign('headers', {'X-Session': sessionId, 'F-Session': sessionId});
        });
        account.sessionId = sessionId;
        this.persistSession(account, sessionId);
        this.log.info(format('Petkit account({}) login success.', account.username));
        return true;
    }

    // login Petkit server with account, if success return session id or failed return undefined.
    // this is the exact login request the official Petkit app sends, see
    // https://github.com/Jezza34000/py-petkit-api for more detail.
    async petkitLogin(conf) {
        const username = conf.get('username');
        const password = conf.get('password');
        const region = conf.get('region');
        const timezone = conf.get('timezone');
        const url = conf.get('account_urls').login;
        const headers = Object.assign({}, conf.get('headers'));
        delete headers['X-Session'];
        delete headers['F-Session'];
        const options = Object.assign({}, globalVariables.default_http_options, {
            'url': url,
            'headers': headers,
            'responseType': 'json',
            'data': querystring.stringify({
                'client': this.buildAccountClientInfo(timezone),
                'encrypt': '1',
                'region': region,
                'username': username,
                'password': this.md5Hex(password),
                'oldVersion': globalVariables.account_client.version,
            }),
        });
        return this.praseLoginResult(await this.http_request(options));
    }

    praseLoginResult(jsonObj) {
        if (!jsonObj) {
            this.log.error('praseLoginResult error: jsonObj is nothing.');
            return undefined;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error') && jsonObj.error) {
            const error_code = (jsonObj.error && jsonObj.error.code !== undefined) ? jsonObj.error.code : undefined;
            const error_msg = (jsonObj.error && jsonObj.error.msg) ? jsonObj.error.msg : '';
            this.log.error(format('Petkit server reply an error when login(code: {}, msg: {}).', error_code, error_msg));
            if (error_code === 122 || error_code === 125) {
                this.log.error('you may need to double check your username and password.');
            }
            return undefined;
        }

        if (!jsonObj.hasOwnProperty('result') ||
            !jsonObj.result.hasOwnProperty('session') ||
            !jsonObj.result.session.hasOwnProperty('id')) {
            this.log.error('unable to parse login reply from server with data: ' + jsonStr);
            return undefined;
        }

        return jsonObj.result.session.id;
    }

    // fetch the family list(also known as group list) of this account, which
    // contains the group id and the device list formerly captured by user.
    // if success return the normalized family list or failed return undefined.
    async petkitGetFamilyList(conf) {
        const url = conf.get('account_urls').familyList;
        const options = Object.assign({}, globalVariables.default_http_options, {
            'url': url,
            'method': 'GET',
            'headers': conf.get('headers'),
            'responseType': 'json',
            'petkitConf': conf,
        });
        return this.praseFamilyList(await this.http_request(options));
    }

    praseFamilyList(jsonObj) {
        if (!jsonObj) {
            this.log.debug('praseFamilyList error: jsonObj is nothing.');
            return undefined;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error') && jsonObj.error) {
            this.log.debug('server reply an error: ' + jsonStr);
            return undefined;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.debug('unable to parse family list reply from server with data: ' + jsonStr);
            return undefined;
        }

        // the result is normally an array of families, but accept the
        // wrapped shapes just in case the server changes the format.
        let families = undefined;
        if (Array.isArray(jsonObj.result)) {
            families = jsonObj.result;
        } else if (jsonObj.result.families) {
            families = jsonObj.result.families;
        } else if (jsonObj.result.groups) {
            families = jsonObj.result.groups;
        } else if (jsonObj.result.list) {
            families = jsonObj.result.list;
        }

        if (!families || families.length === 0) {
            this.log.debug('unable to find any family in family list reply from server with data: ' + jsonStr);
            return undefined;
        }

        // each family in the reply looks like:
        // {groupId: 'xxx', name: 'xxx', deviceList: [{deviceId, deviceType, deviceName, ...}]}
        return families.map(family => ({
            'id': (family.groupId !== undefined ? family.groupId : family.group_id),
            'name': family.name,
            'devices': (family.deviceList || family.device_list || []).map(device => ({
                'type': this.normalizeDeviceType(device.deviceType || device.device_type),
                'id': String(device.deviceId !== undefined ? device.deviceId : device.device_id),
                'name': device.deviceName || device.device_name,
                'data': device,
            })),
        }));
    }

    // normalize device type from server to the plugin's support_device_type
    // format, e.g. feedermini -> FeederMini, feeder -> Feeder
    normalizeDeviceType(deviceType) {
        if (!deviceType) {
            return undefined;
        }
        const lower_type = String(deviceType).toLowerCase();
        if (lower_type === 'feedermini') return 'FeederMini';
        if (lower_type === 'feeder') return 'Feeder';
        return deviceType;
    }

    // fetch devices shared with this account from the device roster v2
    // endpoint. if success return the normalized device list or failed return undefined.
    async petkitGetSharedDevices(conf, groupId) {
        const url = conf.get('account_urls').deviceRosterV2;
        const options = Object.assign({}, globalVariables.default_http_options, {
            'url': url,
            'headers': conf.get('headers'),
            'responseType': 'json',
            'petkitConf': conf,
            'data': querystring.stringify({
                'day': getDataString(),
                'groupId': groupId,
            }),
        });
        return this.praseSharedDevices(await this.http_request(options));
    }

    praseSharedDevices(jsonObj) {
        if (!jsonObj) {
            this.log.debug('praseSharedDevices error: jsonObj is nothing.');
            return undefined;
        }
        const jsonStr = JSON.stringify(jsonObj);
        this.log.debug(jsonStr);

        if (jsonObj.hasOwnProperty('error') && jsonObj.error) {
            this.log.debug('server reply an error: ' + jsonStr);
            return undefined;
        }

        if (!jsonObj.hasOwnProperty('result') || !jsonObj.result.hasOwnProperty('devices')) {
            this.log.debug('unable to parse device roster v2 reply from server with data: ' + jsonStr);
            return undefined;
        }

        return jsonObj.result.devices.map(device => ({
            'type': this.normalizeDeviceType(device.type),
            'id': String(device.id),
            'name': device.deviceTypeAndId || device.type,
            'data': device,
        }));
    }

    // check whether the Petkit server reply indicates that the session is
    // expired or invalid. used to trigger auto re-login in account login mode.
    praseSessionExpiredResult(jsonObj) {
        if (!jsonObj || !jsonObj.hasOwnProperty('error') || !jsonObj.error) {
            return false;
        }

        // error code 5 means session expired, code 122 means authentication
        // failed(usually caused by an invalid session), see
        // https://github.com/Jezza34000/py-petkit-api for more detail.
        if (typeof jsonObj.error === 'object' && jsonObj.error.code !== undefined) {
            return (jsonObj.error.code === 5 || jsonObj.error.code === 122);
        }

        const errorStr = JSON.stringify(jsonObj.error);
        return /session.*(expired|invalid)|(expired|invalid).*session|please.*login|log *in *again|re-?login/i.test(errorStr);
    }

    getSessionFilePath() {
        return path.join(this.api.user.storagePath(), pluginName, 'petkit-session.json');
    }

    loadPersistedSession(account) {
        let data = undefined;
        try {
            const filePath = this.getSessionFilePath();
            if (fs.existsSync(filePath)) {
                data = JSON.parse(fs.readFileSync(filePath));
            }
        } catch (error) {
            this.log.error('load persisted Petkit session failed: ' + error);
        }
        const key = this.getAccountKey(account.server, account.username);
        return (data && data.sessions && data.sessions[key]) ? data.sessions[key] : undefined;
    }

    persistSession(account, sessionId) {
        try {
            const filePath = this.getSessionFilePath();
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, {'recursive': true});
            }
            let data = {'sessions': {}};
            if (fs.existsSync(filePath)) {
                data = JSON.parse(fs.readFileSync(filePath));
                if (!data.sessions) data.sessions = {};
            }
            data.sessions[this.getAccountKey(account.server, account.username)] = {
                'sessionId': sessionId,
                'loginAt': getTimestamp(),
            };
            fs.writeFileSync(filePath, JSON.stringify(data));
            this.log.debug('Petkit session persisted to file: ' + filePath);
        } catch (error) {
            this.log.error('persist Petkit session failed: ' + error);
        }
    }

    // success return data, failed return undefined
    async http_request(options) {
        // return.data and return.error are mutual exclusion
        const request_once = async options => {
            return new Promise(resolve => {
                let result = undefined;
                axios.request(options)
                    .then(response => {
                        if (response.status != 200) {
                            result = {error: 'http request received a invalid response code: ' + response.status};
                        } else {
                            this.log.debug('http request success')
                            result = {data: response.data};
                        }
                    })
                    .catch(error => {
                        result = {error: 'http request failed: ' + error};
                    })
                    .then(() => {
                        resolve(result);
                    });
            });
        };

        let result = undefined;
        result = await request_once(options);

        // account login mode: when the Petkit server reply that the session
        // is expired or invalid, re-login with account automatically and
        // retry the request once.
        if (!options.auth_retried &&
            options.petkitConf &&
            options.petkitConf.get('login_mode') === 'account' &&
            this.praseSessionExpiredResult(result.data)) {
            const conf = options.petkitConf;
            const account = this.accounts.get(this.getAccountKey(conf.get('server'), conf.get('username')));
            if (account) {
                this.log.warn('Petkit session expired, re-login Petkit server with account.');
                if (await this.ensureAccountSession(account, true)) {
                    options.headers = conf.get('headers');
                    options.auth_retried = true;
                    result = await request_once(options);
                }
            }
        }

        // retry logic
        if (result.error &&
            options.retry.enabled &&
            options.timeout > 0) {
            const max_retry = globalVariables.default_http_options.retry.max_retry;
            for (let retry = 2; retry <= max_retry; retry++) {
                result = await request_once(options);
                if (result.error) {
                    this.log.warn(result.error);
                    this.log.warn(format('retry http request: {}/{}', retry, max_retry));
                } else if (result.data) {
                    break;
                }
            }
        }

        if (result.error) {
            this.log.error(result.error);
            this.log.error(format('http request failed: ' + result.error));
        }

        return result.data;
    }

    // fetch all the owned/shared devices of this account from the family
    // list(also known as group list) reply, which also provides the group id
    // formerly captured by user. fall back to device_roster_v2 for the
    // devices shared with this account.
    // the return value has the same format as the device_roster reply so
    // that praseGetOwnedDevice works without any change.
    async http_getOwnDevice(config) {
        const families = await this.petkitGetFamilyList(config);
        if (!families) {
            return undefined;
        }
        this.log.info(format('found {} family(ies) from Petkit server.', families.length));

        let devices = [];
        for (const family of families) {
            let familyDevices = family.devices || [];
            if (familyDevices.length === 0) {
                // no owned device in this family, fetch the shared devices
                const sharedDevices = await this.petkitGetSharedDevices(config, family.id) || [];
                for (const device of sharedDevices) {
                    // the device roster v2 reply does not include device
                    // names, fetch the real name from the device detail
                    // endpoint and fall back to the type + id string when it
                    // is unavailable.
                    const detailName = await this.http_getSharedDeviceName(config, device.type, device.id);
                    if (detailName) {
                        device.name = detailName;
                    }
                }
                familyDevices = sharedDevices;
            }
            devices = devices.concat(familyDevices);
        }

        return {
            'result': {
                'devices': devices.map(device => ({
                    'type': device.type,
                    'data': Object.assign({}, device.data, {'id': device.id, 'name': device.name}),
                })),
            },
        };
    }

    // fetch the name of a device from its device detail endpoint, the device
    // roster v2 reply does not include device names. returns undefined when
    // the name is unavailable, in which case the fallback name is kept.
    async http_getSharedDeviceName(config, type, deviceId) {
        if (!globalVariables.device_urls[type]) {
            return undefined;
        }
        const url_template = globalVariables.device_urls[type].deviceDetailInfo;
        const url = config.get('server') + format(url_template, deviceId);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            method: 'GET',
            headers: config.get('headers'),
            responseType: 'json',
            petkitConf: config,
        });
        try {
            const detail = await this.http_request(options);
            if (detail && detail.result && detail.result.name) {
                return String(detail.result.name);
            }
        } catch (error) {
            this.log.debug(format('unable to fetch device({}) name from server, keep the fallback name: {}', deviceId, (error.message || error)));
        }
        return undefined;
    }

    async http_getDeviceInfo(petkitDevice) {
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').deviceDetailInfo;
        const url = format(url_template, deviceId);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json',
            petkitConf: petkitDevice.config
        });
        return await this.http_request(options);
    }

    async http_getDeviceDailyFeeds(petkitDevice) {
        const date = getDataString();
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').dailyfeeds;
        const url = format(url_template, deviceId, date);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json',
            petkitConf: petkitDevice.config
        });
        return await this.http_request(options);
    }

    async http_getDeviceState(petkitDevice) {
        // {
        //     "result": {
        //         "batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,
        //         "errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,
        //         "pim":1,"runtime":49677,"wifi":{
        //             "bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"
        //         }
        //     }
        // }
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').deviceState;
        const url = format(url_template, deviceId);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json',
            petkitConf: petkitDevice.config
        });
        return await this.http_request(options);
    }

    // date：20200920、time: 68400(-1 stand for current)、amount in app unit，1 for 5g, 10 is max(50g)
    async http_saveDailyFeed(petkitDevice, amount, time) {
        const date = getDataString();
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').saveDailyFeed;
        const url = format(url_template, deviceId, date, time, amount * 5);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json',
            petkitConf: petkitDevice.config
        });
        return await this.http_request(options);
    }

    // key see support_settings.
    async http_updateDeviceSettings(petkitDevice, key, value) {
        const setting_key = globalVariables.support_settings[key];
        if (setting_key !== undefined) {
            let data = {};
            data[setting_key] = value;
            const deviceId = petkitDevice.config.get('deviceId');
            const url_template = petkitDevice.config.get('urls').updateSettings;
            const url = format(url_template, deviceId, JSON.stringify(data));
            const options = Object.assign({}, globalVariables.default_http_options, {
                url: url,
                headers: petkitDevice.config.get('headers'),
                responseType: 'json',
                petkitConf: petkitDevice.config
            });
            return await this.http_request(options);
        } else {
            this.log.warn('unsupport setting: ' + key);
            return false;
        }
    }

    async http_resetDesiccant(petkitDevice) {
        const deviceId = petkitDevice.config.get('deviceId');
        const url_template = petkitDevice.config.get('urls').resetDesiccant;
        const url = format(url_template, deviceId);
        const options = Object.assign({}, globalVariables.default_http_options, {
            url: url,
            headers: petkitDevice.config.get('headers'),
            responseType: 'json',
            petkitConf: petkitDevice.config
        });
        return await this.http_request(options);
    }

    async http_getDeviceDetailStatus(petkitDevice, callback) {
        let deviceDetailInfo = undefined;
        this.http_getDeviceInfo(petkitDevice)
        .then(device_detail_raw => {
            deviceDetailInfo = this.praseGetDeviceDetailInfo(device_detail_raw);
        })
        .catch(error => {
            this.log.error(format('unable to get device({}) status: {}', petkitDevice.config.get('deviceId'), error));
        })
        .then(() => {
            if (deviceDetailInfo) {
                petkitDevice.status = Object.assign(petkitDevice.status, deviceDetailInfo.status);
                petkitDevice.status.lastUpdate = getTimestamp();
            }
            if (callback) callback(deviceDetailInfo);
        });
    }
    
    uploadStatusToHomebridge(petkitDevice) {
        let service = undefined;
        let service_status = undefined;

        this.log.debug(JSON.stringify(petkitDevice.status));

        // battery service only for Petkit Feeder Mini
        if (petkitDevice.config.get('model') === 'FeederMini') {        
            // battery
            service = petkitDevice.services.battery_status_service;
            // battery level
            service_status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel;
            this.log.info(format('battery level is {}%.', service_status));
            service.setCharacteristic(Characteristic.BatteryLevel, service_status);
            
            // charging state
            if (petkitDevice.status.batteryStatus === 0) {
                service_status = Characteristic.ChargingState.CHARGING;
                this.log.info('battery is charging.');
            } else {
                service_status = Characteristic.ChargingState.NOT_CHARGING;
                this.log.info('battery is not charging.');
            }
            service.setCharacteristic(Characteristic.ChargingState, service_status);

            // low battery status
            if (petkitDevice.status.batteryStatus !== 0 &&
                !petkitDevice.config.get('ignore_battery_when_charging') &&
                petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel <= 50) {
                service_status = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
                this.log.info('battery level status is low');
            } else {
                service_status = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                this.log.info('battery level status is normal');
            }
            service.setCharacteristic(Characteristic.StatusLowBattery, service_status);
        }


        // manualLock
        if (petkitDevice.config.get('enable_manualLock')) {
            service = petkitDevice.services.manualLock_service;
            service_status = petkitDevice.status.manualLock === 0;

            this.log.info(format('manualLock status is {}.', service_status ? 'on' : 'off'));
            const current_status = service.getCharacteristic(Characteristic.On).value;
            if (current_status != service_status) {
                service.setCharacteristic(Characteristic.On, service_status);
            }
        } else {
            this.log.info('manualLock function is disabled.');
        }

        // lightMode
        if (petkitDevice.config.get('enable_lightMode')) {
            service = petkitDevice.services.lightMode_service;
            service_status = petkitDevice.status.lightMode;

            this.log.info(format('lightMode status is {}.', service_status ? 'on' : 'off'));
            const current_status = service.getCharacteristic(Characteristic.On).value;
            if (current_status != service_status) {
                service.setCharacteristic(Characteristic.On, service_status);
            }
        } else {
            this.log.info('lightMode function is disabled.');
        }

        // food
        service = petkitDevice.services.food_storage_service;
        if (petkitDevice.config.get('model') === 'Feeder') {
            if (petkitDevice.status.food > globalVariables.config.foodStorage_alerm_threshold) {
                this.log.info('there is enough food left.');
            } else {
                this.log.warn('there is not enough food left !!!');
            }
        }
        else if(petkitDevice.config.get('model') === 'FeederMini') {
            if (petkitDevice.status.food == 0) {
                this.log.warn('there is not enough food left !!!');
            } else {
                this.log.info('there is enough food left.');
            }
        }
        service_status = petkitDevice.getFoodStatusForHomebridge();
        service.setCharacteristic(Characteristic.OccupancyDetected, service_status);

        // desiccant
        if (petkitDevice.config.get('enable_desiccant')) {
            service = petkitDevice.services.desiccant_level_service;
            if (petkitDevice.status.desiccantLeftDays < petkitDevice.config.get('alert_desiccant_threshold')) {
                if (petkitDevice.config.get('enable_autoreset_desiccant')) {
                    service_status = Characteristic.FilterChangeIndication.CHANGE_FILTER;
                    this.log.info(format('desiccant only {} day(s) left, reset it.', petkitDevice.status.desiccantLeftDays));
                    this.hb_desiccantLeftDays_reset(petkitDevice, () => {
                        service.setCharacteristic(Characteristic.FilterChangeIndication, Characteristic.FilterChangeIndication.FILTER_OK);
                    });
                } else {
                    this.log.info('desiccant auto reset function is disabled.');
                }
            } else {
                this.log.info(format('desiccant has {} days left, no need to reset.', petkitDevice.status.desiccantLeftDays));
                service_status = Characteristic.FilterChangeIndication.FILTER_OK;
            }
            service.setCharacteristic(Characteristic.FilterChangeIndication, service_status);
        } else {
            this.log.info('desiccant service is disabled');
        }
    }

    setupPolling(petkitDevice) {
        if (petkitDevice.config.get('enable_polling')) {
            const polling_interval_ms = petkitDevice.config.get('polling_interval') * 1000;
            const polling_options = {
                longpolling: true,
                interval: polling_interval_ms,
                longpollEventName: 'deviceStatusUpdatePoll'
            };
    
            setTimeout(() => {
                petkitDevice.events.polling_event = pollingtoevent(done => {
                    this.log.info('polling start...');
                    this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                        this.uploadStatusToHomebridge(petkitDevice);
                        this.log.info('polling end...');
                        done();
                    });
                }, polling_options);
            }, polling_interval_ms)
        } else {
            this.log.warn('polling is disabled.');
        }
    }

    hb_handle_set_deviceSettings(petkitDevice, settingName, status, callback = null) {
        let result = false;
        this.http_updateDeviceSettings(petkitDevice, settingName, status)
            .then(data => {
                if (!data) {
                    this.log.error('failed to commuciate with server.');
                } else if (this.praseUpdateDeviceSettingsResult(data)) {
                    result = true;
                    petkitDevice.status[settingName] = status;
                }
            }).catch(error => {
                this.log.error(error);
            }).then(() => {
                if (callback) callback(result);
                // this.updataDeviceDetail();
            });
    }

    hb_mealAmount_set(petkitDevice, value, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        petkitDevice.savedData.mealAmount = value;
        petkitDevice.save();
        this.log.info('set meal amount to ' + value);
        if (!fast_response) callback(null);
    }

    hb_dropMeal_set(petkitDevice, value, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        if (value) {
            if (petkitDevice.savedData.mealAmount) {
                this.log.info(format('drop food:{} meal(s)', petkitDevice.savedData.mealAmount));

                var result = false;
                this.http_saveDailyFeed(petkitDevice, petkitDevice.savedData.mealAmount, -1)
                    .then(data => {
                        if (!data) {
                            this.log.error('failed to commuciate with server.');
                        } else {
                            result = this.praseSaveDailyFeedResult(data);
                            this.log.info('food drop result: ' + result ? 'success' : 'failed');
                        }
                    })
                    .catch(error => {
                        this.log.error('food drop failed: ' + error);
                    })
                    .then(() => {
                        if (!fast_response) callback(null);
                    });
            } else {
                this.log.info('drop food with zero amount, pass.');
            }
            
            setTimeout(() => {
                petkitDevice.services.drop_meal_service.setCharacteristic(Characteristic.On, false);
            }, 200);

            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        }
        // this.updataDeviceDetail();
    }

    hb_desiccantIndicator_get(petkitDevice, callback) {
        const status = (petkitDevice.status.desiccantLeftDays < petkitDevice.config.get(' ') ? 1 : 0);
        callback(null, status);
    }

    hb_desiccantLeftDays_get(petkitDevice, callback) {
        const status = petkitDevice.status.desiccantLeftDays;
        callback(null, status);
    }

    // reset Desiccant Left Days 
    hb_desiccantLeftDays_reset(petkitDevice, callback) {
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response && callback) {callback(null);}
        this.http_resetDesiccant(petkitDevice)
            .then(data => {
                if (data && data.result) {
                    petkitDevice.status.desiccantLeftDays = data.result;
                    this.log.info(format('reset desiccant left days success, reset to {} days', data.result));
                } else {
                    this.log.warn('reset desiccant left days with a unrecognizable reply.');
                }
            })
            .catch(error => {
                this.log.error('reset desiccant left days failed: ' + error);
            })
            .then(() => {
                if (!fast_response && callback) callback(null);
                setTimeout(() => {
                    this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                        this.uploadStatusToHomebridge(petkitDevice);
                    })
                }, 1000);
            });
    }

    hb_foodStorageStatus_get(petkitDevice, callback) {
        const status = petkitDevice.getFoodStatusForHomebridge();
        callback(null, status);
    }

    hb_manualLockStatus_get(petkitDevice, callback) {
        const status = petkitDevice.status.manualLock ? 0 : 1;
        callback(null, status);
    }

    hb_manualLockStatus_set(petkitDevice, value, callback) {
        const settingName = 'manualLock';
        const settingValue = (value ? 0 : 1);
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        this.log.debug(format('set {} to: {}', settingName, settingValue));
        this.hb_handle_set_deviceSettings(petkitDevice, settingName, settingValue, result => {
            if (result) {
                this.log.info(format('set {} to: {}, success', settingName, settingValue));
            } else {
                this.log.warn(format('set {} to: {}, failed', settingName, settingValue));
            }
            if (!fast_response) callback(null);
            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        });
    }

    hb_lightModeStatus_get(petkitDevice, callback) {
        const status = petkitDevice.status.lightMode;
        callback(null, status);

        // this.hb_handle_get(petkitDevice, 'hb_lightModeStatus_get', results => {
        //     const status = petkitDevice.status.lightMode;
        //     callback(null, status);
        // });
    }

    hb_lightModeStatus_set(petkitDevice, value, callback) {
        const settingName = 'lightMode';
        const settingValue = value;
        const fast_response = petkitDevice.config.get('fast_response');
        if (fast_response) callback(null);
        this.log.debug(format('set {} to: {}', settingName, settingValue));
        this.hb_handle_set_deviceSettings(petkitDevice, settingName, settingValue, result => {
            if (result) {
                this.log.info(format('set {} to: {}, success', settingName, settingValue));
            } else {
                this.log.warn(format('set {} to: {}, failed', settingName, settingValue));
            }
            if (!fast_response) callback(null);
            setTimeout(() => {
                this.http_getDeviceDetailStatus(petkitDevice, deviceDetailInfo => {
                    this.uploadStatusToHomebridge(petkitDevice);
                })
            }, 1000);
        });
    }

    hb_deviceBatteryLevel_get(petkitDevice, callback) {
        const status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel;
        callback(null, status);
    }

    hb_deviceChargingState_get(petkitDevice, callback) {
        const status = (petkitDevice.status.batteryStatus === 0 ?
            Characteristic.ChargingState.CHARGING :
            Characteristic.ChargingState.NOT_CHARGING);
        callback(null, status);
    }

    hb_deviceStatusLowBattery_get(petkitDevice, callback) {
        const status = petkitDevice.status.batteryPower * globalVariables.config.batteryPersentPerLevel < 50 ?
            Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
            Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        callback(null, status);
    }
};

module.exports = function (homebridge) {
    PlatformAccessory = homebridge.platformAccessory;
    // Categories = homebridge.hap.Accessory.Categories;
    Accessory = homebridge.hap.Accessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(pluginName, platformName, petkit_feeder_plugin, true);
};
