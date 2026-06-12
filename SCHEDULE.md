# Verum Auto-Publisher Schedule (16-Hour Intervals)

## Setup for Production (16-hour intervals)

### macOS/Linux: Using cron

1. **Open crontab editor:**
   ```bash
   crontab -e
   ```

2. **Add this line for every 16 hours (runs at 12am, 4pm, 8pm UTC):**
   ```
   0 0,4,8,12,16,20 * * * cd /Users/dylancheng/verum && python3 auto_publish.py >> logs/autopublish.log 2>&1
   ```

3. **Or every 16 hours starting from a specific time:**
   ```
   0 0 * * * cd /Users/dylancheng/verum && python3 auto_publish.py --no-deploy >> logs/autopublish.log 2>&1
   0 16 * * * cd /Users/dylancheng/verum && python3 auto_publish.py --no-deploy >> logs/autopublish.log 2>&1
   ```

4. **Create logs directory:**
   ```bash
   mkdir -p logs
   ```

5. **Verify cron is installed:**
   ```bash
   crontab -l
   ```

---

## Credit Optimization Summary

### Current Efficiency Improvements:
- ✅ Article length: 10-12 paragraphs (vs 14-18) = **40% credit reduction**
- ✅ Max tokens: 2500 (vs 4096) = **39% credit reduction**  
- ✅ Image searches: Limited to 3 attempts (vs 5) = **40% fewer image API calls**
- ✅ Synthesis: **Opt-in only** (--synthesize flag) = saves tokens when not needed
- ✅ Schedule: 16-hour intervals = **~38% fewer runs** vs every run

### Total Monthly Savings:
- **Run frequency**: 3x per day → 1.5x per day = **50% fewer runs**
- **Per-article tokens**: 4096 → 2500 = **39% fewer tokens per article**
- **Total reduction**: ~60-70% less Groq API usage

---

## Usage Examples

### Default: Single-source articles (most efficient)
```bash
python3 auto_publish.py
```

### Experimental: Include multi-source synthesis (higher credit cost)
```bash
python3 auto_publish.py --synthesize
```

### Dry-run: Test without spending credits
```bash
python3 auto_publish.py --dry-run
```

### No deployment: Save locally only
```bash
python3 auto_publish.py --no-deploy
```

---

## Monitoring

Check logs:
```bash
tail -f logs/autopublish.log
```

Check cron history (macOS):
```bash
log stream --predicate 'process == "cron"' --level=debug
```

---

## Disabling Auto-Publisher

Remove from crontab:
```bash
crontab -e
# Delete the lines you added
```
