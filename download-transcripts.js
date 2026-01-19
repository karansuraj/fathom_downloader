#!/usr/bin/env node

/**
 * Fathom Transcript Bulk Exporter
 * 
 * Downloads all transcripts from your Fathom account.
 * 
 * Usage:
 *   FATHOM_API_KEY=your_key node download-transcripts.js
 * 
 * Options (via env vars):
 *   FATHOM_API_KEY     - Required. Get from https://fathom.video/customize#api-access-header
 *   OUTPUT_DIR         - Output directory (default: ./transcripts)
 *   INCLUDE_SUMMARY    - Also download summaries (default: true)
 *   CREATED_AFTER      - Filter: only meetings after this date (ISO format)
 *   CREATED_BEFORE     - Filter: only meetings before this date (ISO format)
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.fathom.ai/external/v1';

// Load ".env" (if present) before reading process.env config
require('dotenv').config();

const API_KEY = process.env.FATHOM_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './transcripts';
const INCLUDE_SUMMARY = process.env.INCLUDE_SUMMARY !== 'false';
const CREATED_AFTER = process.env.CREATED_AFTER;
const CREATED_BEFORE = process.env.CREATED_BEFORE;

// Rate limit: 60 calls/minute, so ~1 call/second to be safe
const RATE_LIMIT_DELAY_MS = 1100;

if (!API_KEY) {
  console.error('Error: FATHOM_API_KEY environment variable is required');
  console.error('Get your API key from: https://fathom.video/customize#api-access-header');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || 60;
      console.log(`Rate limited. Waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      continue;
    }
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  throw new Error('Max retries exceeded');
}

async function listMeetings() {
  const meetings = [];
  let cursor = null;
  
  console.log('Fetching meeting list...');
  
  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (CREATED_AFTER) params.set('created_after', CREATED_AFTER);
    if (CREATED_BEFORE) params.set('created_before', CREATED_BEFORE);
    
    const url = `${API_BASE}/meetings?${params.toString()}`;
    const data = await fetchWithRetry(url, {
      headers: { 'X-Api-Key': API_KEY }
    });
    
    meetings.push(...data.items);
    cursor = data.next_cursor;
    
    process.stdout.write(`\rFetched ${meetings.length} meetings...`);
    
    if (cursor) await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);
  
  console.log(`\nFound ${meetings.length} total meetings`);
  return meetings;
}

async function getTranscript(recordingId) {
  const url = `${API_BASE}/recordings/${recordingId}/transcript`;
  return fetchWithRetry(url, {
    headers: { 'X-Api-Key': API_KEY }
  });
}

async function getSummary(recordingId) {
  const url = `${API_BASE}/recordings/${recordingId}/summary`;
  return fetchWithRetry(url, {
    headers: { 'X-Api-Key': API_KEY }
  });
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

function formatTranscript(transcript) {
  if (!transcript || !Array.isArray(transcript)) return '';
  
  return transcript
    .map(entry => {
      const speaker = entry.speaker?.display_name || 'Unknown';
      const timestamp = entry.timestamp || '';
      const text = entry.text || '';
      return `[${timestamp}] ${speaker}: ${text}`;
    })
    .join('\n');
}

async function downloadAll() {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const meetings = await listMeetings();
  
  if (meetings.length === 0) {
    console.log('No meetings found.');
    return;
  }
  
  console.log(`\nDownloading transcripts to: ${path.resolve(OUTPUT_DIR)}`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    const recordingId = meeting.recording_id;
    const title = meeting.title || meeting.meeting_title || `meeting_${recordingId}`;
    const date = meeting.created_at?.split('T')[0] || 'unknown';
    const filename = sanitizeFilename(`${date}_${title}`);
    
    process.stdout.write(`\r[${i + 1}/${meetings.length}] ${title.substring(0, 40)}...`);
    
    try {
      // Get transcript
      await sleep(RATE_LIMIT_DELAY_MS);
      const transcriptData = await getTranscript(recordingId);
      const transcriptText = formatTranscript(transcriptData.transcript);
      
      // Build output content
      let content = `# ${title}\n`;
      content += `Date: ${meeting.created_at}\n`;
      content += `URL: ${meeting.url}\n`;
      content += `Recording ID: ${recordingId}\n`;
      content += `\n---\n\n`;
      
      // Get summary if requested
      if (INCLUDE_SUMMARY) {
        await sleep(RATE_LIMIT_DELAY_MS);
        try {
          const summaryData = await getSummary(recordingId);
          if (summaryData.summary?.markdown_formatted) {
            content += `## Summary\n\n${summaryData.summary.markdown_formatted}\n\n---\n\n`;
          }
        } catch (e) {
          // Summary might not be available for all meetings
        }
      }
      
      content += `## Transcript\n\n${transcriptText}`;
      
      // Write file
      const filepath = path.join(OUTPUT_DIR, `${filename}.md`);
      fs.writeFileSync(filepath, content);
      successCount++;
      
    } catch (error) {
      errorCount++;
      console.error(`\nError downloading ${title}: ${error.message}`);
    }
  }
  
  console.log(`\n\nComplete!`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Output: ${path.resolve(OUTPUT_DIR)}`);
}

// Run
downloadAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
