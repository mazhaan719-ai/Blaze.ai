const{Client,GatewayIntentBits,REST,Routes,SlashCommandBuilder,AttachmentBuilder,EmbedBuilder,Partials}=require('discord.js');
const fetch=(...a)=>import('node-fetch').then(({default:f})=>f(...a));
const TOKEN=process.env.TOKEN;
const CLIENT_ID=process.env.CLIENT_ID;
const GROQ_KEY=process.env.GROQ_KEY;
const CF_TOKEN=process.env.CF_TOKEN||'cfut_AoghjU8nrSo9ZbZwEtW2VZcW7yZ9eIrMOjfyvG2x6cc9481a';
const CF_ACCOUNT_ID=process.env.CF_ACCOUNT_ID||'0ed991d019c1c9f6ebac707c39cb8a02';
const GROQ_API='https://api.groq.com/openai/v1/chat/completions';
const CF_IMAGE_MODEL='@cf/black-forest-labs/flux-1-schnell';
const MODELS=[{id:'llama-3.1-8b-instant',label:'Llama 3.1 8B'},{id:'llama-3.3-70b-versatile',label:'Llama 3.3 70B'},{id:'openai/gpt-oss-120b',label:'GPT-OSS 120B'},{id:'meta-llama/llama-4-scout-17b-16e-instruct',label:'Llama 4 Scout'}];
const TONES={balanced:'You are VOID AI, a premium AI assistant. Be accurate, helpful, concise. Use Discord markdown. No preamble. Keep responses short.',roast:'You are VOID AI in ROAST MODE. Savage, brutally honest. ROAST first, answer second. Keep it short.',expert:'You are VOID AI, a technical expert. Be precise, no fluff. Keep responses short.',casual:'You are VOID AI, friendly and conversational. Keep responses short.',concise:'You are VOID AI. Ultra-concise. Short answers only.'};
const userState=new Map();

function getState(id){
  if(!userState.has(id))userState.set(id,{modelIdx:0,history:[],tone:'balanced'});
  return userState.get(id);
}

function pruneHistory(state){
  const TEN_MINS=10*60*1000;
  const now=Date.now();
  state.history=state.history.filter(m=>now-m.time<TEN_MINS);
}

async function groqChat(state,msg){
  pruneHistory(state);
  const m=MODELS[state.modelIdx];
  const hist=state.history.slice(-6).map(m=>({role:m.role,content:m.content}));
  state.history.push({role:'user',content:msg,time:Date.now()});
  const maxTok=m.id.startsWith('openai/')?800:1024;
  const res=await fetch(GROQ_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+GROQ_KEY},body:JSON.stringify({model:m.id,messages:[{role:'system',content:TONES[state.tone]},...hist,{role:'user',content:msg}],temperature:0.7,top_p:0.95,max_tokens:maxTok})});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error&&e.error.message||'HTTP '+res.status);}
  const data=await res.json();
  const reply=data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content||'*(no response)*';
  state.history.push({role:'assistant',content:reply,time:Date.now()});
  return reply;
}

async function generateCFImage(prompt,style){
  const fullPrompt=style&&style!=='none'?prompt+', '+style+' style':prompt;
  const url='https://api.cloudflare.com/client/v4/accounts/'+CF_ACCOUNT_ID+'/ai/run/'+CF_IMAGE_MODEL;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+CF_TOKEN},body:JSON.stringify({prompt:fullPrompt})});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error((e.errors&&e.errors[0]&&e.errors[0].message)||'CF AI HTTP '+res.status);}
  const ct=res.headers.get('content-type')||'';
  if(ct.includes('image')){return Buffer.from(await res.arrayBuffer());}
  const data=await res.json();
  if(data.result&&data.result.image){return Buffer.from(data.result.image,'base64');}
  throw new Error('Unexpected CF AI response format');
}

function splitText(text,max){
  if(text.length<=max)return[text];
  const chunks=[];let i=0;
  while(i<text.length){let end=i+max;if(end<text.length){const nl=text.lastIndexOf('\n',end);if(nl>i)end=nl;}chunks.push(text.slice(i,end));i=end;}
  return chunks;
}

const commands=[
  new SlashCommandBuilder().setName('chat').setDescription('Chat with VOID AI').addStringOption(o=>o.setName('message').setDescription('Your message').setRequired(true)),
  new SlashCommandBuilder().setName('model').setDescription('Change AI model').addStringOption(o=>o.setName('model').setDescription('Model').setRequired(true).addChoices({name:'Llama 3.1 8B',value:'0'},{name:'Llama 3.3 70B',value:'1'},{name:'GPT-OSS 120B',value:'2'},{name:'Llama 4 Scout',value:'3'})),
  new SlashCommandBuilder().setName('tone').setDescription('Change tone').addStringOption(o=>o.setName('tone').setDescription('Tone').setRequired(true).addChoices({name:'Balanced',value:'balanced'},{name:'Roast',value:'roast'},{name:'Expert',value:'expert'},{name:'Casual',value:'casual'},{name:'Concise',value:'concise'})),
  new SlashCommandBuilder().setName('clear').setDescription('Clear history'),
  new SlashCommandBuilder().setName('status').setDescription('Show settings'),
  new SlashCommandBuilder().setName('image').setDescription('Generate image').addStringOption(o=>o.setName('prompt').setDescription('Describe image').setRequired(true)).addStringOption(o=>o.setName('style').setDescription('Style').addChoices({name:'Default',value:'none'},{name:'Photorealistic',value:'photorealistic'},{name:'Anime',value:'anime'},{name:'Cinematic',value:'cinematic'},{name:'Oil Painting',value:'oil painting'},{name:'Pixel Art',value:'pixel art'})),
  new SlashCommandBuilder().setName('imageedit').setDescription('Edit image with AI').addAttachmentOption(o=>o.setName('image').setDescription('Image').setRequired(true)).addStringOption(o=>o.setName('instruction').setDescription('What to do').setRequired(true)).addStringOption(o=>o.setName('style').setDescription('Style').addChoices({name:'Default',value:'none'},{name:'Photorealistic',value:'photorealistic'},{name:'Anime',value:'anime'},{name:'Cinematic',value:'cinematic'},{name:'Oil Painting',value:'oil painting'},{name:'Pixel Art',value:'pixel art'})),
].map(c=>c.toJSON());

const client=new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.DirectMessages,GatewayIntentBits.DirectMessageTyping,GatewayIntentBits.DirectMessageReactions],
  partials:[Partials.Channel,Partials.Message,Partials.Reaction]
});

client.once('ready',()=>{
  console.log('VOID AI online as '+client.user.tag);
  client.user.setActivity('VOID AI | /chat /image',{type:0});
});

client.on('messageCreate',async function(message){
  if(message.author.bot)return;
  if(message.partial){try{await message.fetch();}catch(e){return;}}
  console.log('MSG from '+message.author.tag+': '+message.content);
  const state=getState(message.author.id);
  try{
    await message.channel.sendTyping();
    const reply=await groqChat(state,message.content);
    const chunks=splitText(reply,1900);
    await message.reply(chunks[0]);
    for(let i=1;i<chunks.length;i++)await message.channel.send(chunks[i]);
  }catch(err){
    try{await message.reply('Error: '+err.message);}catch(e){}
  }
});

client.on('interactionCreate',async function(interaction){
  if(!interaction.isChatInputCommand())return;
  const commandName=interaction.commandName;
  const state=getState(interaction.user.id);

  if(commandName==='chat'){
    const msg=interaction.options.getString('message');
    await interaction.deferReply();
    try{
      const reply=await groqChat(state,msg);
      const chunks=splitText(reply,1900);
      const embed=new EmbedBuilder().setColor(0xa78bfa).setAuthor({name:'VOID AI - '+MODELS[state.modelIdx].label,iconURL:client.user.displayAvatarURL()}).setDescription(chunks[0]).setFooter({text:state.tone+' mode · Made by MR.PRO'});
      await interaction.editReply({embeds:[embed]});
      for(let i=1;i<chunks.length;i++)await interaction.followUp({content:chunks[i]});
    }catch(err){await interaction.editReply({content:'Error: '+err.message});}

  }else if(commandName==='model'){
    state.modelIdx=parseInt(interaction.options.getString('model'));
    await interaction.reply({embeds:[new EmbedBuilder().setColor(0x69f0ae).setTitle('Model Updated').setDescription('Now using '+MODELS[state.modelIdx].label)],ephemeral:true});

  }else if(commandName==='tone'){
    state.tone=interaction.options.getString('tone');
    await interaction.reply({embeds:[new EmbedBuilder().setColor(0xffd600).setTitle('Tone Updated').setDescription('Now in '+state.tone+' mode')],ephemeral:true});

  }else if(commandName==='clear'){
    state.history=[];
    await interaction.reply({embeds:[new EmbedBuilder().setColor(0xff4500).setTitle('Cleared').setDescription('History reset.')],ephemeral:true});

  }else if(commandName==='status'){
    pruneHistory(state);
    await interaction.reply({embeds:[new EmbedBuilder().setColor(0xa78bfa).setTitle('VOID AI Status').addFields({name:'Model',value:MODELS[state.modelIdx].label,inline:true},{name:'Tone',value:state.tone,inline:true},{name:'History',value:Math.floor(state.history.length/2)+' msgs (10min window)',inline:true}).setFooter({text:'Made by MR.PRO'})],ephemeral:true});

  }else if(commandName==='image'){
    const prompt=interaction.options.getString('prompt');
    const style=interaction.options.getString('style')||'none';
    await interaction.deferReply();
    try{
      const buf=await generateCFImage(prompt,style);
      const embed=new EmbedBuilder().setColor(0xa78bfa).setAuthor({name:'VOID AI Image Generator',iconURL:client.user.displayAvatarURL()}).setDescription(prompt).setImage('attachment://void-image.png').setFooter({text:'FLUX.1 Schnell · Cloudflare Workers AI · Made by MR.PRO'});
      await interaction.editReply({embeds:[embed],files:[new AttachmentBuilder(buf,{name:'void-image.png'})]});
    }catch(err){await interaction.editReply({content:'Image failed: '+err.message});}

  }else if(commandName==='imageedit'){
    const att=interaction.options.getAttachment('image');
    const instruction=interaction.options.getString('instruction');
    const style=interaction.options.getString('style')||'none';
    await interaction.deferReply();
    try{
      const full=(style!=='none'?instruction+', '+style+' style, high quality':instruction+', high quality')+(att&&att.url?', based on: '+att.url:'');
      const buf=await generateCFImage(full,'none');
      const embed=new EmbedBuilder().setColor(0x00bcd4).setAuthor({name:'VOID AI Image Edit',iconURL:client.user.displayAvatarURL()}).addFields({name:'Instruction',value:instruction},{name:'Style',value:style!=='none'?style:'Default',inline:true}).setImage('attachment://void-edited.png').setFooter({text:'FLUX.1 Schnell · Cloudflare Workers AI · Made by MR.PRO'});
      await interaction.editReply({embeds:[embed],files:[new AttachmentBuilder(buf,{name:'void-edited.png'})]});
    }catch(err){await interaction.editReply({content:'Edit failed: '+err.message});}
  }
});

(async function(){
  const rest=new REST({version:'10'}).setToken(TOKEN);
  console.log('Registering commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID),{body:commands});
  console.log('Commands registered.');
  await client.login(TOKEN);
})();
