'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;


const fs = require('fs');
const packageConfig = require('./package.json')
const axios = require('axios');
const deasyncPromise = require('deasync-promise');
const event = require('events');
const format = require('string-format');
const dayjs = require('dayjs');
const pollingtoevent = require('polling-to-event');

const logUtil = require('./utils/log');
const configUtil = require('./utils/config');

const default_headers = Object.freeze({
    'X-Client': 'ios(14.0;iPhone12,3)',
    'Accept': '*/*',
    'X-Timezone': '8.0',
    'Accept-Language': 'en-US;q=1, zh-Hans-US;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'X-Api-Version': '7.18.1',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'PETKIT/7.18.1 (iPhone; iOS 14.0; Scale/3.00)',
    'X-TimezoneId': 'Asia/Shanghai',
    'X-Locale': 'en_US'
})

const support_settings = Object.freeze({
    'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
    'lightMode' : 'settings.lightMode',
});

const global_urls = Object.freeze({
    'cn': {
        'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
        'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petkit.cn/6/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petkit.cn/6/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petkit.cn/6/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
        'resetDesiccant': 'http://api.petkit.cn/6/feedermini/desiccant_reset?deviceId={}',
        'updateSettings': 'http://api.petkit.cn/6/feedermini/update?id={}&kv={}',
    },
    'asia':{
        'owndevices': 'http://api.petktasia.com/latest/discovery/device_roster',
        'deviceState': 'http://api.petktasia.com/latest/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petktasia.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petktasia.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petktasia.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
        'resetDesiccant': 'http://api.petktasia.com/latest/feedermini/desiccant_reset?deviceId={}',
        'updateSettings': 'http://api.petktasia.com/latest/feedermini/update?id={}&kv={}',
    },
    'north_america':{
        'owndevices': 'http://api.petkt.com/latest/discovery/device_roster',
        'deviceState': 'http://api.petkt.com/latest/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petkt.com/latest/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petkt.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petkt.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petkt.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petkt.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
        'resetDesiccant': 'http://api.petkt.com/latest/feedermini/desiccant_reset?deviceId={}',
        'updateSettings': 'http://api.petkt.com/latest/feedermini/update?id={}&kv={}',
    }
});

const min_amount = 0;                   // in meal(same in app)
const max_amount = 10;                  // in meal(same in app)
const min_desiccantLeftDays = 0;        // in day
const max_desiccantLeftDays = 30;       // in day
const min_batteryLevel = 0;             // level(same in app)
const max_batteryLevel = 4;             // level(same in app)
const min_pollint_interval = 60;        // in second
const max_pollint_interval = 3600;      // in second
const min_fetch_status_interval = 10;   // in second

const batteryPersentPerLevel = 100 / max_batteryLevel;

module.exports = function (homebridge) {
    PlatformAccessory = homebridge.platformAccessory;
    Accessory = homebridge.hap.Accessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-petkit-feeder-mini', 'petkit_feeder_mini', petkit_feeder_mini_plugin, true);
}

function getTimestamp() {
    return Math.floor(Date.now() / 1000);
}

function getDataString() {
    return dayjs(new Date()).format('YYYYMMDD');
}

class petkit_feeder_mini_plugin {
    constructor(log, config, api) {
        this.log = new logUtil(log, this.config.fulfill('log_level', logUtil.LOGLV_INFO));
        this.log.info('begin to initialize petkit feeder mini.');

        if (!api) {
            this.log.error("Homebridge's version is too old, please upgrade!");
            return;
        }

        if (!config) {
            this.log.warn("no configure found for petkit feeder mini.");
            return;
        }

        this.api = api;
        this.accessories = new Map();

        // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
        // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
        // Or start discover new accessories.
        this.api.on('didFinishLaunching', () => {
            this.log.info('Initializing petkit feeder mini device.');
            // check config usability
            config.devices.forEach((device_config) => {
                const config = this.configDeviceCheck(device_config);
                if (config) {
                    this.initializeAccessory(config);
                }
            });
        });

        this.log.info('petkit feeder mini loaded successfully.');
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    configureAccessory(accessory) {
        this.log.info('Configuring cached accessory: [' + accessory.displayName + '] ' + ' ' + accessory.UUID + '');
        this.accessories.set(accessory.UUID, accessory);
    }

    initializeAccessory(config) {
        this.log.debug('initialize accessory: ' + config.name + ' (' + config.accessory_type + ')');

        const uuid = UUIDGen.generate(config.name);
        let accessory = this.accessories.get(uuid);

        if (!accessory) {
            // accessory not exists, create accessory
            accessory = new this.api.platformAccessory(config.name, uuid, config.name);
            this.api.registerPlatformAccessories('homebridge-raspberry-simpleGPIO', 'raspberry_simple_gpio', [accessory]);
        }

        // setup fan service
        let gpio_service = accessory.getService(config.name);
        if (!gpio_service) {
            // service not exist, create service
            gpio_service = accessory.addService(Service.Fan, config.name, config.name);
            if (!gpio_service) {
                this.log.error('accessory service create failed.');
                return;
            }
        }

        // setup info service
        let info_service = accessory.getService(config.name);
        if (!info_service) {
            // service not exist, create service
            info_service = accessory.addService(Service.AccessoryInformation, config.name, config.name);
            if (!info_service) {
                this.log.error('accessory service create failed.');
                return;
            }
        }

        // all service setup success, now update accessory
        this.accessories.set(uuid, accessory);
    }

    // config usability check
    // return valid config or null
    configDeviceCheck(config) {
        config.name = getConfigValue(config.name, 'Raspberry-GPIO');

        return config;
    }
}