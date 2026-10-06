export const tuning={
  tickHz:60,moveSpeed:1.8,heroRadius:0.25,heroMaxHealth:100,
  attack:{windup:10,activeEnd:15,total:36,range:1.65,halfAngle:0.95,damage:34},
  dodge:{total:18,invulnerableStart:1,invulnerableEnd:13,speed:7,cooldown:50,facing:'travel-or-aim'},
  ability:{windup:10,total:36,cooldown:180,range:3,damage:24,stun:50},
  hurt:{total:10},enemy:{maxHealth:70,speed:1.15,windup:30,activeEnd:34,total:58,range:1.05,damage:12},
  room:{halfSize:7.5},
} as const;
export const clipForState={idle:'idle',walk:'walk',attack:'attack_sword_01',dodge:'dodge',ability:'cast_lantern_flare',hurt:'hit',death:'death'} as const;
export const props=[
  {id:'pillar',kind:'pillar',x:-2,z:0,radius:.5,height:2.4},
  {id:'tree',kind:'tree',x:2.8,z:-1.8,radius:.45,height:2.6},
  {id:'corner',kind:'wall',x:-4.2,z:-3.1,radius:.7,height:1.4},
  {id:'foreground',kind:'foreground',x:3.5,z:3.7,radius:.5,height:2.1},
] as const;
