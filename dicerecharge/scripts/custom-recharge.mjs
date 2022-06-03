import { SETTING_NAMES } from "./settings.mjs";
import { MODULE_NAME } from "./const.mjs";
import { MODULE_FORMULA } from "./const.mjs";
import { MODULE_DESTROY, MODULE_CHECK, MODULE_DIE, MODULE_THRESHOLD } from "./const.mjs";
import { CONST_TABLE } from "./const.mjs";
import { APPLICABLE_ITEM_TYPES } from "./const.mjs";
import { TIME_PERIODS, DIE_TYPES, MODULE_ALWAYS, MODULE_DEFAULT } from "./const.mjs";




export class DiceRecharge {
	
	/* Request a recharge of magic items */
	static rechargeItems = async (actor, time) => {
		if(!actor) return;
		const time_of_day = DiceRecharge._moduleTimePeriods().includes(time) ? [time] : DiceRecharge._moduleTimePeriods();
		
		// get visual setting:
		const roll_dice = game.settings.get(MODULE_NAME, SETTING_NAMES.DICE_ROLL);
		
		// get items that can recharge:
		const rechargingItems = actor.items.filter(i => {
			
			let flag = i.getFlag(MODULE_NAME, MODULE_FORMULA) ?? "";
			if(!Roll.validate(flag)) return false;
			
			let {value, max, per} = i.getChatData().uses;
			//if(value >= max) return false; // commented out; items may regain negative charges.
			if(!time_of_day.includes(per)) return false;
			
			return true;
		});
		
		if(rechargingItems.length < 1) return;
		
		// create updates and rolls arrays:
		const updates = [];
		const diceRolls = [];
		let table_body = "";
		for(let item of rechargingItems){
			const {value, max} = item.getChatData().uses;
			let recoveryFormula = item.getFlag(MODULE_NAME, MODULE_FORMULA) ?? "0";
			recoveryFormula = Roll.replaceFormulaData(recoveryFormula, actor.getRollData());
			const rechargingRoll = new Roll(recoveryFormula);
			const {total} = await rechargingRoll.evaluate({async: true});
			
			// skip this item if it rolled a positive result but was already at max.
			if(value === max && total > 0) continue;
			
			// skip this item if it rolled a negative result but was already at zero.
			if(value === 0 && total < 0) continue;
			
			// add to table.
			const newValue = Math.clamped(value + total, 0, max);
			table_body += `
				<tr>
					<td>${item.name}</td>
					<td style="text-align: center">${value}</td>
					<td style="text-align: center">${newValue}</td>
				</tr>`;
			diceRolls.push([rechargingRoll, item.name]);
			updates.push({_id: item.id, "data.uses.value": newValue});
		}
		
		// bail out if there were no updates.
		if(updates.length < 1) return;
		
		// Show the table of recharges or show each item roll individually.
		if(!roll_dice && updates.length > 1){
			for(let dr of diceRolls) game.dice3d?.showForRoll(dr[0], game.user, true);
			await ChatMessage.create({
				user: game.user.id,
				speaker: ChatMessage.getSpeaker({actor, alias: "Magic Items"}),
				flavor: `${actor.name}'s magic items recharge:`,
				content: `${CONST_TABLE.HEADER}${table_body}${CONST_TABLE.FOOTER}`
			});
		}else{
			for(let [roll, name] of diceRolls){
				roll.toMessage({
					user: game.user.id,
					flavor: `${name} recharges`,
					speaker: ChatMessage.getSpeaker({actor})
				});
			}
		}
		
		return actor.updateEmbeddedDocuments("Item", updates);
	}
	
	/* Figure out if the item's type is allowed to be destroyed. */
	static _applicableItemType = (item) => {
		/* The item's type. */
		const itemType = item?.type;
		if(!itemType) return false;
		
		/* Default allowed item types. */
		const allowedTypes = new Set(APPLICABLE_ITEM_TYPES.ALWAYS);
		
		/* Add optional item types if enabled, else remove them. */
		for(let optionalType of APPLICABLE_ITEM_TYPES.OPTIONAL){
			if(game.settings.get(MODULE_NAME, optionalType)){
				allowedTypes.add(optionalType);
			} else allowedTypes.delete(optionalType);
		}
		
		/* Return true or false if the set of allowed types contains the item's type. */
		return allowedTypes.has(itemType);
	}
	
	/* Return whether the item's recovery method is valid for Destruction feature. */
	static _validRecoveryMethod = (item) => {
		return Object.keys(CONFIG.DND5E.limitedUsePeriods).includes(item?.getChatData()?.uses?.per);
	}
	
	/* Get module-added recovery methods. */
	static _moduleTimePeriods = () => {
		return Object.keys(TIME_PERIODS);
	}
	
	/* Add the charge recovery fields to item sheet. */
	static _addChargeRecoveryField = (itemSheet, html) => {
		// dont even bother if the recovery method is not one of those I allow.
		if(!DiceRecharge._moduleTimePeriods().includes(itemSheet.item?.getChatData().uses?.per)) return;
		
		// get the current recovery formula, if any.
		const recoveryFormula = itemSheet.item.getFlag(MODULE_NAME, MODULE_FORMULA) ?? "";
		
		// create the new html element in the item's sheet.
		const div = document.createElement("div");
		div.setAttribute("class", "form-group dicerecharge");
		div.innerHTML = `
			<label>Recovery formula</label>
			<div class="form-fields">
				<input type="text" name="flags.${MODULE_NAME}.${MODULE_FORMULA}" value="${recoveryFormula}" />
			</div>`;
		let per = html[0].querySelector(".form-group.uses-per");
		per.parentNode.insertBefore(div, per.nextSibling);
	}
	
	/* Add the destruction fields to item sheet. */
	static _addDestructionField = (itemSheet, html) => {
		// dont even bother if Destruction is completely disabled.
		if(!game.settings.get(MODULE_NAME, SETTING_NAMES.DESTROY_ENABLED)) return;
		
		// dont even bother if the item's type is not allowed.
		if(!DiceRecharge._applicableItemType(itemSheet.item)) return;
		
		// dont even bother if the item actually does not show the destruction config.
		if(!DiceRecharge._validRecoveryMethod(itemSheet.item)) return;
		
		// get the current destruction configuration, if any.
		const check = itemSheet.item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_CHECK}`) ?? false;
		const die = itemSheet.item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_DIE}`) ?? MODULE_DEFAULT;
		const threshold = itemSheet.item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_THRESHOLD}`) ?? 1;
		
		// create the new html element in the item's sheet.
		const div = document.createElement("div");
		div.setAttribute("class", "form-group destruction");
		div.innerHTML = `
			<label>Item Destruction</label>
			<div class="form-fields">
				<input
					type="checkbox"
					name="flags.${MODULE_NAME}.${MODULE_DESTROY}.${MODULE_CHECK}"
					${check ? "checked" : ""}
				>
				<span class="sep">Destroyed&nbsp;if&nbsp;</span>
				<select
					name="flags.${MODULE_NAME}.${MODULE_DESTROY}.${MODULE_DIE}"
					${!check ? "disabled" : ""}
				>
				` + Object.entries(DIE_TYPES).reduce( (acc, [key, value]) => acc += `<option value="${key}" ${die === key ? "selected" : ""}>${value}</option>`, ``) + `
				</select>
				<span class="sep">&le;&nbsp;</span>
				<input
					type="number"
					name="flags.${MODULE_NAME}.${MODULE_DESTROY}.${MODULE_THRESHOLD}"
					data-dtype="Number"
					value="${(die === MODULE_ALWAYS || !check) ? "" : threshold ? threshold : 1}"
					min="1"
					oninput="validity.valid || (value=1)"
					${(die === MODULE_ALWAYS || !check) ? "disabled" : ""}
				>
			</div>`;
		let per = html[0].querySelector(".form-group.uses-per");
		per?.parentNode?.insertBefore(div, per.nextSibling);
	}
	
	static _destroyItems = (item, diff, _, userId) => {
		// dont even bother if Destruction is completely disabled.
		if(!game.settings.get(MODULE_NAME, SETTING_NAMES.DESTROY_ENABLED)) return;
		
		// dont even bother if the item's type is not allowed.
		if(!DiceRecharge._applicableItemType(item)) return;
		
		// dont run this for anyone but the one updating the item.
		if(userId !== game.user.id) return;
		
		// dont even bother if the item is not set to be destroyed.
		if(!item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_CHECK}`)) return;
		
		// dont even bother if the item update was not triggered by the item hitting 0 or null charges.
		if(diff.data?.uses?.value !== 0 && diff.data?.uses?.value !== null) return;
		
		// dont even bother if the change to 0 or null was also FROM a value of 0 or null.
		if(diff.oldValue === 0 || diff.oldValue === null) return;
		
		// dont even bother if the item actually does not show the destruction config.
		if(!DiceRecharge._validRecoveryMethod(item)) return;
		
		// dont even bother if the item is not owned by an actor.
		if(!item.parent) return;
		
		// get the values we need to use a lot.
		const die = item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_DIE}`) ?? MODULE_DEFAULT;
		const threshold = item.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_THRESHOLD}`) ?? 1;
		
		// determine if the item should roll for destruction or skip it (i.e., if die is set to "Always").
		const roll_to_destroy = die !== MODULE_ALWAYS;
		
		// create the dialog.
		new Dialog({
			title: item.name,
			content: `
				<p style="text-align:center;"><img src="${item.data.img}" style="width: 35%; border: none" /></p>
				<hr>
				<p>${item.name} has reached zero charges.</p>`
				+ (roll_to_destroy ? `<p>Roll a ${die}; on a ${threshold > 1 ? threshold + " or lower" : threshold}, the item is permanently destroyed.</p><hr>`
				: `<p>The item is permanently destroyed.</p><hr>`),
			buttons: {
				roll: {
					icon: `<i class="fas fa-check"></i>`,
					label: roll_to_destroy ? `Roll a ${die}` : `Destroy Item`,
					callback: async () => {
						if(roll_to_destroy){
							const roll = new Roll(`1${die}`);
							const {total} = await roll.evaluate({async: true});
							const flavor = total <= threshold ? `${item.name} was destroyed...` : `${item.name} survived losing all its charges`;
							roll.toMessage({
								flavor,
								speaker: ChatMessage.getSpeaker({actor: item.parent})
							});
							
							// destroy item in the preferred way:
							if(total <= threshold){
								if(game.settings.get(MODULE_NAME, SETTING_NAMES.DESTROY_MANUAL)) await item.deleteDialog();
								else await item.delete();
							}
						}else{
							await ChatMessage.create({
								user: game.user.id,
								speaker: ChatMessage.getSpeaker({actor: item.parent}),
								content: `${item.name} was destroyed...`
							});
							await item.delete();
						}
					}
				}
			},
			default: "roll"
		}).render(true, {height: "100%"});
	}
	
}

/* Add "dawn" and "dusk" recharge methods. */
Hooks.once("ready", () => {
	CONFIG.DND5E.limitedUsePeriods = mergeObject(CONFIG.DND5E.limitedUsePeriods, TIME_PERIODS);
});

/* Add destruction fields. */
Hooks.on("renderItemSheet5e", DiceRecharge._addDestructionField);

/* Add a charge recovery field. */
Hooks.on("renderItemSheet5e", DiceRecharge._addChargeRecoveryField);

/* Recharge items on rest. */
Hooks.on("dnd5e.restCompleted", async (actor, data) => {
	if(!data.newDay || !actor) return;
	DiceRecharge.rechargeItems(actor);
});

/* Item destruction */
Hooks.on("updateItem", DiceRecharge._destroyItems);

/* Remember what the old value was. */
Hooks.on("preUpdateItem", (item, diff) => {
	// get the item's old value.
	let oldValue = item.data?.data?.uses?.value;
	
	// gets the item's new value.
	let newValue = diff?.data?.uses?.value;
	
	// save the old value for later if both old and new are defined (null is important).
	if(oldValue !== undefined && newValue !== undefined) diff.oldValue = oldValue;
});

/* Flag a message with item data if the item is set to be destroyed. */
Hooks.on("createChatMessage", async (msg) => {
	const {user, content} = msg.data;
	if(game.user.id !== user) return;
	
	// actor and their item.
	const actorIndex = content.indexOf("data-actor-id");
	const itemIndex = content.indexOf("data-item-id");
	if(actorIndex === -1 || itemIndex === -1) return;
	const actorId = content.substring(actorIndex + 15, actorIndex + 15 + 16);
	const itemId = content.substring(itemIndex + 14, itemIndex + 14 + 16);
	
	// bail out if we couldn't find either.
	if(!actorId || !itemId) return;
	
	// get the item.
	const item = game.actors.get(actorId)?.items.get(itemId);
	
	// check if it is set to destroy.
	const toDestroy = item?.getFlag(MODULE_NAME, `${MODULE_DESTROY}.${MODULE_CHECK}`) ?? false;
	
	// flag the message if it is not already.
	if(toDestroy && !msg.getFlag("dnd5e", "itemData")) await msg.setFlag("dnd5e", "itemData", item?.toObject());
});