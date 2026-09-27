const { OpenAI } = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAndConvert(audioFilePath) {
  try {
    // 1. Whisper API를 통한 STT (음성 -> 텍스트)
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    // 2. GPT를 통한 한글 발음 표기 생성 (영문/외국어 가사 -> 한글 발음)
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '너는 외국어 문장을 들리는 그대로 한글 발음(한글 한글자씩)으로 변환하는 전문 번역기야. 예: "I am walking" -> "(아임 워킹)". 오직 괄호 안에 한글 발음만 반환해.'
        },
        {
          role: 'user',
          content: transcription.text
        }
      ]
    });

    return {
      originalText: transcription.text,
      pronunciationText: response.choices[0].message.content.trim(),
      segments: transcription.segments
    };
  } catch (error) {
    console.error('Transcription error:', error);
    throw error;
  }
}

module.exports = { transcribeAndConvert };