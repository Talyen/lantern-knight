export const tuning={
  cameraFollow:true,
  tickHz:60,moveSpeed:1.8,heroRadius:0.25,heroMaxHealth:100,
  attack:{windup:10,activeEnd:15,total:36,range:1.65,halfAngle:0.95,damage:26},
  inputBufferTicks:8,dashBufferTicks:5,comboResetTicks:20,deathHoldTicks:45,maxCombatHeightDifference:.65,
  dodge:{total:18,invulnerableStart:1,invulnerableEnd:13,speed:7,cooldown:50,facing:'travel-or-aim'},
  ability:{windup:10,total:30,cooldown:180,range:3,halfAngle:.55,damage:16,stun:30},
  hurt:{total:10},enemy:{maxHealth:70,speed:1.15,windup:30,activeEnd:34,total:58,range:1.05,damage:12},
  room:{halfSize:7.5},
} as const;
export const swordCombo=[
  {...tuning.attack,clip:'attack_sword_01',linkStart:20,linkEnd:35,cancelStart:18,arcSign:1},
  {clip:'attack_sword_02',windup:8,activeEnd:13,total:32,range:1.75,halfAngle:1.05,damage:30,linkStart:18,linkEnd:31,cancelStart:16,arcSign:-1},
  {clip:'attack_sword_03',windup:12,activeEnd:18,total:44,range:1.9,halfAngle:1.15,damage:42,linkStart:44,linkEnd:44,cancelStart:22,arcSign:1},
] as const;
export function attackDefinition(actor:{kind:'hero'|'enemy';swingStage:number;definition:{melee:{windup:number;activeEnd:number;total:number;range:number;halfAngle:number;damage:number}}}){return actor.kind==='hero'?swordCombo[actor.swingStage]!:actor.definition.melee;}
export const clipForState={idle:'idle',walk:'walk',attack:'attack_sword_01',dodge:'dodge',ability:'cast_lantern_flare',hurt:'hit',death:'death'} as const;
