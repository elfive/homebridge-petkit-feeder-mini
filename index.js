'use strict';

let PlatformAccessory, Accessory, Service, Characteristic, UUIDGen;


const logUtil = require('./utils/log');
const configUtil = require('./utils/config');
const petkit_feeder_mini = require('./device/petkit_feeder_mini');

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
        this.log.info('begin to initialize petkit feeder platform.');

        if (!api) {
            this.log.error("Homebridge's version is too old, please upgrade!");
            return;
        }

        if (!config) {
            this.log.warn("no configure found for petkit feeder device.");
            return;
        }

        this.api = api;
        this.accessories = new Map();

        // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
        // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
        // Or start discover new accessories.
        this.api.on('didFinishLaunching', () => {
            // check config usability
            config.devices.forEach((device_config) => {
                const config = this.configDeviceCheck(device_config);
                if (config) {
                    this.initializeAccessory(config);
                }
            });
        });

        this.log.info('petkit feeder platform loaded successfully.');
    }

    // REQUIRED - Homebridge will call the "configureAccessory" method once for every cached accessory restored
    configureAccessory(accessory) {
        this.log.info('Configuring cached accessory: [' + accessory.displayName + '] ' + ' ' + accessory.UUID + '');
        this.accessories.set(accessory.UUID, accessory);
    }

    // configure example
    // {
    //     "name": "小佩喂食器",
    //     "DropMeal_name": "出粮",
    //     "MealAmount_name": "出粮数量",
    //     "FoodStorage_name": "余量",
    //     "DesiccantLevel_name": "干燥剂指示器",
    //     "ManualLock_name": "手动出粮锁",
    //     "LightMode_name": "灯光",
    //     "Battery_name": "电池状态",
    //     "location": "cn",
    //     "headers": [
    //         {
    //             "key": "X-Session",
    //             "value": "a9b3cde11db74b23bf7649fbac0db526XskdkHA4AOmFe9JU0slG"
    //         },
    //         {
    //             "key": "X-Timezone",
    //             "value": "8.0"
    //         }
    //     ],
    //     "autoDeviceInfo": true,
    //     "sn": "PetkitFeederMini",
    //     "firmware": "1.0.0",
    //     "manufacturer": "Petkit",
    //     "model": "Petkit feeder mini",
    //     "enable_polling": true,
    //     "polling_interval": 60,
    //     "enable_desiccant": true,
    //     "alert_desiccant_threshold": 7,
    //     "enable_autoreset_desiccant": true,
    //     "reset_desiccant_threshold": 5,
    //     "enable_manualLock": true,
    //     "enable_lightMode": true,
    //     "reverse_foodStorage_indicator": true,
    //     "fast_response": true,
    //     "accessory": "petkit_feeder_mini"
    // }

    // initialize one accessory
    initializeAccessory(config) {
        this.log.debug('Initializing petkit device: ' + config.name);

        const uuid = UUIDGen.generate(config.name);
        let accessory = this.accessories.get(uuid);

        if (!accessory) {
            // accessory not exists, create accessory
            accessory = new this.api.platformAccessory(config.name, uuid, config.name);
            if (!accessory) {
                this.log.error('petkit device service create failed: accessory');
                return;
            }
        }

        // setup meal drop service
        if (true) {
            let drop_meal_service = accessory.getService(config.DropMeal_name);
            if (!drop_meal_service) {
                // service not exist, create service
                drop_meal_service = accessory.addService(Service.Switch, config.DropMeal_name, config.DropMeal_name);
                if (!drop_meal_service) {
                    this.log.error('petkit device service create failed: drop_meal_service');
                    return;
                }
            }

            drop_meal_service.getCharacteristic(Characteristic.On)
                .on('get', (callback) => callback(null, 0))
                .on('set', this.hb_dropMeal_set.bind(this));
        }

        // setup meal amount service
        if (true) {
            let meal_amount_service = accessory.getService(config.MealAmount_name);
            if (!meal_amount_service) {
                // service not exist, create service
                meal_amount_service = accessory.addService(Service.Fan, config.MealAmount_name, config.MealAmount_name);
                if (!meal_amount_service) {
                    this.log.error('petkit device service create failed: meal_amount_service');
                    return;
                }
            }

            meal_amount_service.getCharacteristic(Characteristic.On)
                .on('get', (callback) => callback(null, this.mealAmount != 0));
            meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
                .on('get', (callback) => callback(null, this.mealAmount))
                .on('set', this.hb_mealAmount_set.bind(this))
                .setProps({
                    minValue: min_amount,
                    maxValue: max_amount,
                    minStep: 1
                });
        }

        // setup food storage indicator service
        if (true) {
            let food_storage_service = accessory.getService(config.FoodStorage_name);
            if (!food_storage_service) {
                // service not exist, create service
                food_storage_service = accessory.addService(Service.OccupancySensor, config.FoodStorage_name, config.FoodStorage_name);
                if (!food_storage_service) {
                    this.log.error('petkit device service create failed: food_storage_service');
                    return;
                }
            }

            food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, this.deviceDetailInfo['food'])
            food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', this.hb_foodStorageStatus_get.bind(this));
        }

        // setup desiccant left days service
        if (config.enable_desiccant) {
            let desiccant_level_service = accessory.getService(config.DesiccantLevel_name);
            if (!desiccant_level_service) {
                // service not exist, create service
                desiccant_level_service = accessory.addService(Service.FilterMaintenance, config.DesiccantLevel_name, config.DesiccantLevel_name);
                if (!desiccant_level_service) {
                    this.log.error('petkit device service create failed: desiccant_level_service');
                    return;
                }
            }
    
            desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication,
                (this.deviceDetailInfo['desiccantLeftDays'] < this.alert_desiccant_threshold ? 1 : 0));
            desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
                .on('get', this.hb_desiccantIndicator_get.bind(this));
            
            desiccant_level_service.setCharacteristic(Characteristic.FilterLifeLevel, this.deviceDetailInfo['desiccantLeftDays']);
            desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
                .on('get', this.hb_desiccantLeftDays_get.bind(this))
                .setProps({
                    minValue: min_desiccantLeftDays,
                    maxValue: max_desiccantLeftDays,
                    minStep: 1
                });
            
            desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
                .on('set', this.hb_desiccantLeftDays_reset.bind(this));
        }

        // setup manualLock setting service
        if (config.enable_manualLock) {
            let manualLock_service = accessory.getService(config.ManualLock_name);
            if (!manualLock_service) {
                // service not exist, create service
                manualLock_service = accessory.addService(Service.Switch, config.ManualLock_name, config.ManualLock_name);
                if (!manualLock_service) {
                    this.log.error('petkit device service create failed: manualLock_service');
                    return;
                }
            }

            manualLock_service.setCharacteristic(Characteristic.On, this.deviceDetailInfo['manualLock']);
            manualLock_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this))
                .on('set', this.hb_manualLockStatus_set.bind(this));
        }

        // setup lightMode setting service
        if (config.enable_lightMode) {
            let lightMode_service = accessory.getService(config.LightMode_name);
            if (!lightMode_service) {
                // service not exist, create service
                lightMode_service = accessory.addService(Service.OccupancySensor, config.LightMode_name, config.LightMode_name);
                if (!lightMode_service) {
                    this.log.error('petkit device service create failed: lightMode_service');
                    return;
                }
            }
            
            lightMode_service.setCharacteristic(Characteristic.On, this.deviceDetailInfo['manualLock']);
            lightMode_service.getCharacteristic(Characteristic.On)
                .on('get', this.hb_manualLockStatus_get.bind(this))
                .on('set', this.hb_manualLockStatus_set.bind(this));
        }

        // setup battery status service
        if (true) {
            let battery_status_service = accessory.getService(config.Battery_name);
            if (!battery_status_service) {
                // service not exist, create service
                battery_status_service = accessory.addService(Service.OccupancySensor, config.Battery_name, config.Battery_name);
                if (!battery_status_service) {
                    this.log.error('petkit device service create failed: battery_status_service');
                    return;
                }
            }
            
            battery_status_service.setCharacteristic(Characteristic.BatteryLevel, this.deviceDetailInfo['batteryPower']);
            battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
                .on('get', this.hb_deviceBatteryLevel_get.bind(this));
            
            battery_status_service.setCharacteristic(Characteristic.ChargingState, (this.deviceDetailInfo['batteryStatus'] == 0 ?
                    Characteristic.ChargingState.CHARGING :
                    Characteristic.ChargingState.NOT_CHARGING));
            battery_status_service.getCharacteristic(Characteristic.ChargingState)
                .on('get', this.hb_deviceChargingState_get.bind(this));
    
            battery_status_service.setCharacteristic(Characteristic.StatusLowBattery, (this.deviceDetailInfo['batteryPower'] <= 50 ?
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL));
            battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', this.hb_deviceStatusLowBattery_get.bind(this));
        }

        // setup divice information service
        if (true) {
            let info_service = accessory.getService('info_service');
            if (!info_service) {
                // service not exist, create service
                info_service = accessory.addService(Service.AccessoryInformation, 'info_service', 'info_service');
                if (!info_service) {
                    this.log.error('petkit device service create failed: info_service');
                    return;
                }
            }

            info_service
                .setCharacteristic(Characteristic.Identify, config.deviceId)
                .setCharacteristic(Characteristic.Manufacturer, config.manufacturer)
                .setCharacteristic(Characteristic.Model, config.model)
                .setCharacteristic(Characteristic.SerialNumber, config.serialNumber)
                // infomation below changed from petkit app require a homebridge reboot to take effect.
                .setCharacteristic(Characteristic.Name, config.name)
                .setCharacteristic(Characteristic.FirmwareRevision, config.firmware);
        }

        // all service setup success, now update accessory
        this.accessories.set(uuid, accessory);
        this.api.registerPlatformAccessories('homebridge-petkit-feeder-mini', 'petkit_feeder_mini', [accessory]);
    }

    // config usability check
    // return valid config or null
    configDeviceCheck(config) {
        config.name = getConfigValue(config.name, 'PetkitFeederMini');

        return config;
    }
}