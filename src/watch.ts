/*!
 * Copyright (c) The Free MRE Foundation. All rights reserved.
 * Licensed under the GPLv3 License.
 */

import { Actor, ActorPath, Animation, AnimationDataLike, AnimationEaseCurves, AnimationWrapMode, AssetContainer, AttachPoint, Context, DegreesToRadians, Guid, Quaternion, ScaledTransformLike, User } from "@microsoft/mixed-reality-extension-sdk";
import { translate } from "./utils";

export enum WatchType {
	ANALOG = 'ANALOG',
	DIGITAL = 'DIGITAL',
}

export interface WatchOptions {
	name?: string,
	type: WatchType,
	resourceId: string,
	transform?: Partial<ScaledTransformLike>,
	parentId?: Guid,
	owner: User,
	timezone: string,
}

export interface AnalogWatchOptions extends WatchOptions {
	hands: { [name: string]: string },
	handsTransforms: { [name: string]: ScaledTransformLike }
}

export abstract class Watch {
	abstract remove(): void;
	abstract reattach(): void;
}

export class AnalogWatch extends Watch {
	private watch: Actor;

	// hands
	private hands: Map<string, Actor>;
	private animations: Map<string, Animation>;

	constructor(private context: Context, private assets: AssetContainer, private options: AnalogWatchOptions) {
		super();
		this.hands = new Map<string, Actor>();
		this.animations = new Map<string, Animation>();
		this.init();
	}

	private async init() {
		const local = this.options.transform ? translate(this.options.transform) : {};
		this.watch = Actor.CreateFromLibrary(this.context, {
			resourceId: this.options.resourceId,
			actor: Object.assign(
				{
					transform: {
						local
					},
				},
				this.options.owner ? {
					attachment: {
						userId: this.options.owner.id,
						attachPoint: "left-hand" as AttachPoint,
					},
				} : (this.options.parentId ? {
					parentId: this.options.parentId,
				} : {}),
			),
		});

		await Promise.all(['hour', 'minute', 'second'].map(name => {
			const local = translate(this.options.handsTransforms[name]).toJSON();
			const actor = Actor.CreateFromLibrary(this.context, {
				resourceId: this.options.hands[name],
				actor: {
					parentId: this.watch.id,
					transform: {
						local
					}
				}
			});
			this.hands.set(name, actor);
			return actor.created();
		}));

		this.start();
	}

	private start() {
		this.animateHands(this.now());
	}

	private animateHands(time: number) {
		[...this.hands.keys()].forEach(async name => {
			let full = 0;
			let duration = 0;
			let init = 0;
			switch (name) {
				case 'hour':
					full = 12 * 3600;
					init = time / full * 360;
					duration = (360 - init) / 360 * full
					break;
				case 'minute':
					full = 3600;
					init = time % full / full * 360;
					duration = (360 - init) / 360 * full
					break;
				case 'second':
					full = 60;
					init = time % full / full * 360;
					duration = (360 - init) / 360 * full;
					break;
			}
			await this.animateHandHelper(name, init, duration, false);
			this.animateHandHelper(name, 0, full, true);
		});
	}

	private async animateHandHelper(name: string, init: number, duration: number, loop: boolean) {
		const keyframes = [
			{
				time: 0,
				value: Quaternion.FromEulerAngles(0, init * DegreesToRadians, 0)
			},
			{
				time: duration,
				value: Quaternion.FromEulerAngles(0, 360 * DegreesToRadians, 0)
			}
		];
		if (init < 180) {
			keyframes.splice(1, 0, {
				time: duration / (360 - init) * (180 - init),
				value: Quaternion.FromEulerAngles(0, 180 * DegreesToRadians, 0)
			});
		}

		const actor = this.hands.get(name);
		const animationName = `${name} ${init} ${duration}`;
		let animationData = this.assets.animationData.find(a => a.name == animationName);
		if (!animationData) {
			const animationDataLike: AnimationDataLike = {
				tracks: [
					{
						target: ActorPath('actor').transform.local.rotation,
						easing: AnimationEaseCurves.Linear,
						keyframes
					}
				]
			};
			animationData = this.assets.createAnimationData(animationName, animationDataLike);
		}
		const animation = await animationData.bind({ actor }, {
			isPlaying: true,
			wrapMode: loop ? AnimationWrapMode.Loop : AnimationWrapMode.Once
		});
		this.animations.set(name, animation);

		if (!loop) {
			await new Promise(r => setTimeout(r, animationData.duration() * 1000));
		}
	}

	public stop() {
		this.animations.forEach(a => a.stop());
	}

	private now() {
		const tz = this.options.timezone ? this.options.timezone : 'Europe/London';
		const d = new Date(Date.now());
		const t = d.toLocaleTimeString("en-US", { timeZone: tz, hour12: true }).split(' ')[0].split(':').map(x => parseFloat(x));

		return t[0] * 3600 + t[1] * 60 + t[0];
	}

	public remove() {
		this.stop();
		this.watch.destroy();
	}

	public reattach() {
		if (!this.options.owner) return;
		this.watch.detach();
		this.watch.attach(this.options.owner.id, 'left-hand');
	};
}