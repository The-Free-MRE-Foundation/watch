/*!
 * Copyright (c) The Free MRE Foundation. All rights reserved.
 * Licensed under the GPLv3 License.
 */

import { Actor, AlphaMode, AssetContainer, BoxAlignment, ButtonBehavior, ColliderType, CollisionLayer, Color3, Color4, Context, Guid, ParameterSet, PlanarGridLayout, User } from "@microsoft/mixed-reality-extension-sdk";
import { fetchJSON, geoloc, translate } from "./utils";
import { AnalogWatch, AnalogWatchOptions, Watch, WatchOptions, WatchType } from "./watch";
const geoTz = require('geo-tz');

const DISPENSER_DIMENSIONS = {
        width: 0.2,
        height: 0.2,
        depth: 0.2
}

const DEFAULT_WATCHES = [
        {
                name: 'Rolex',
                type: WatchType.ANALOG,
                resourceId: 'artifact:2070313858047673011',
                transform: {
                        rotation: { x: 0, y: 180, z: 0 }
                },
                hands: {
                        'hour': 'artifact:2070313857653408432',
                        'minute': 'artifact:2070313858173502132',
                        'second': 'artifact:2070313857913455281',
                },
                handsTransforms: {
                        'hour': {
                                position: { x: 0, y: 0.043836, z: 0 }
                        },
                        'minute': {
                                position: { x: 0, y: 0.04401, z: 0 }
                        },
                        'second': {
                                position: { x: 0, y: 0.044185, z: 0 }
                        },
                }
        }
];

/**
 * The main class of this app. All the logic goes here.
 */
export default class App {
        private url: string;
        private options: WatchOptions[];

        private assets: AssetContainer;
        private anchor: Actor;
        private gridLayout: PlanarGridLayout;
        private dispensers: Actor[];
        private timezones: Map<Guid, string>;
        private watches: Map<Guid, Watch>;

        constructor(private context: Context, params: ParameterSet) {
                this.url = params['url'] as string;
                this.timezones = new Map<Guid, string>();
                this.watches = new Map<Guid, Watch>();

                this.assets = new AssetContainer(this.context);
                this.assets.createMaterial('invisible', { color: Color4.FromColor3(Color3.Red(), 0.0), alphaMode: AlphaMode.Blend });

                this.context.onStarted(() => this.started());
                this.context.onUserJoined((u: User) => this.userjoined(u));
                this.context.onUserLeft((u: User) => this.userleft(u));
        }

        private async init(){
                this.options = this.url ? await fetchJSON(this.url) : DEFAULT_WATCHES;
                this.createWatchDispenser();
        }

        private createWatchDispenser() {
                this.anchor?.destroy();
                this.anchor = Actor.Create(this.context);
                this.gridLayout = new PlanarGridLayout(this.anchor);
                this.dispensers = this.options.map((o, i) => {
                        // collider
                        const dim = DISPENSER_DIMENSIONS;
                        let mesh = this.assets.meshes.find(m => m.name === 'mesh_dispenser_collider');
                        if (!mesh) {
                                mesh = this.assets.createBoxMesh('mesh_dispenser_collider', dim.width, dim.height, dim.depth);
                        }

                        const material = this.assets.materials.find(m => m.name === 'invisible');
                        const collider = Actor.Create(this.context, {
                                actor: {
                                        parentId: this.anchor.id,
                                        appearance: {
                                                meshId: mesh.id,
                                                materialId: material.id,
                                        },
                                        collider: {
                                                geometry: {
                                                        shape: ColliderType.Box
                                                },
                                                layer: CollisionLayer.Hologram
                                        }
                                }
                        });

                        // model
                        const local = translate(o.transform).toJSON();
                        switch (o.type) {
                                case WatchType.ANALOG:
                                        new AnalogWatch(this.context, this.assets, {
                                                ...(o as AnalogWatchOptions),
                                                parentId: collider.id,
                                        });
                                        break;
                        }
                        this.gridLayout.addCell({
                                row: 0,
                                column: i,
                                width: dim.width,
                                height: dim.height,
                                contents: collider,
                        });

                        return collider;
                });

                this.gridLayout.gridAlignment = BoxAlignment.MiddleLeft;
                this.gridLayout.applyLayout();

                this.setButtonBehaviors();
        }

        private setButtonBehaviors() {
                this.dispensers.forEach((d, i) => {
                        d.setBehavior(ButtonBehavior).onClick((user, _) => {
                                this.equipWatch(user, i);
                        });
                });
        }

        private equipWatch(user: User, i: number) {
                const options = this.options[i];
                const timezone = this.timezones.get(user.id);
                switch (options.type) {
                        case WatchType.ANALOG:
                                new AnalogWatch(this.context, this.assets, {
                                        ...(options as AnalogWatchOptions),
                                        owner: user,
                                        timezone: timezone ? timezone : 'Europe/London',
                                });
                                break;
                }
        }

        /**
         * Once the context is "started", initialize the app.
         */
        private async started() {
                this.init();
        }

        private async userjoined(user: User) {
                const geo = await geoloc(user.properties.remoteAddress);
                const tzs = geoTz.find(geo.lat, geo.lon) as string[];
                this.timezones.set(user.id, tzs[0]);
        }

        private async userleft(user: User) {
                if (this.watches.has(user.id)) {
                        this.watches.get(user.id).remove();
                        this.watches.delete(user.id);
                }
                this.timezones.delete(user.id);
        }
}