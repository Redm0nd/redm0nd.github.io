---
layout: post
title:  "Lambda's new 30 minute timeout: running 30 million Man United seasons in one function"
date:   2026-11-24 05:30:00 +0000
categories: jekyll update
canonical_url: https://builder.aws.com/content/3MWWrxWWpuDPN6CfIikBX1eLd8g/lambdas-new-30-minute-timeout-running-30-million-man-united-seasons-in-one-function
---

*This post was originally published on [AWS Builder Center](https://builder.aws.com/content/3MWWrxWWpuDPN6CfIikBX1eLd8g/lambdas-new-30-minute-timeout-running-30-million-man-united-seasons-in-one-function).*

## Preface

Since I started working with Lambda in 2018, the first question I ask before putting anything on it is "will it finish in 15 minutes?".

If the answer was "probably not", it went to Fargate or Batch, or got chopped up with Step Functions to stay under the limit. Back in 2024 I wrote about [passing properties from S3 to Batch via EventBridge](https://redm0nd.github.io/2024/09/02/S3-EventBridge-Batch.html) and to be honest, half the reason that pattern exists is the 15 minute limit.

Then on November 19th AWS [raised the on-demand Lambda timeout to 30 minutes](https://aws.amazon.com/blogs/compute/announcing-30-minute-timeout-for-on-demand-aws-lambda-event-functions/). So I wanted to build something that actually needs more than 15 minutes and see what happens.

I've gone with a Monte Carlo simulator that answers the question every United fan asks around this time of year: **can Man United still make the top 4?**

It pulls this season's Premier League results from [football-data.co.uk](https://www.football-data.co.uk/englandm.php), works out how good each team is and plays out the rest of the season 30 million times. All in a single 21 minute Lambda invocation.

Now, anyone who's watched United this season already knows the answer. After 11 games they're **19th on 8 points** with one league win, a [5–2 against Ipswich back in August](https://www.si.com/soccer/man-utd-drop-relegation-zone-man-city-defeat-red-devils-40-year-low). It's the first time they've been in the bottom three this far into a season since 1986.

They're not making the top 4. But I wanted an actual number on it, and while I'm at it, one on relegation too.

In this post I'll go through:

- An SQS → Lambda → S3 pipeline in Terraform with a 30 minute timeout
- The Python simulator, with no framework and only numpy
- The gotchas to watch out for with long-running functions
- Deploy, verify and clean-up steps

All the code is on GitHub: [Redm0nd/mufc-montecarlo](https://github.com/Redm0nd/mufc-montecarlo)

## What changed

The 30 minutes only applies to **Event Functions**, the classic event-driven Lambda. This is from the [announcement](https://aws.amazon.com/blogs/compute/announcing-30-minute-timeout-for-on-demand-aws-lambda-event-functions/):

| Lambda type | Sync | Async | Event source mapping |
| --- | --- | --- | --- |
| Event Functions, on demand | 30 min | 30 min | 30 min |
| Event Functions, Managed Instances | 30 min | 90 min | 90 min |
| Web Functions | 15 min | 15 min | 15 min |

There are a few things to be aware of:

- **Not every event source mapping gets it.** Amazon MQ and DocumentDB mappings stay at 14 minutes. So do Kafka mappings created before November 19th, unless you recreate them or turn on provisioned mode.
- **Init is still 10 seconds** on demand, so heavy imports still need to load quickly.
- **The caller has its own timeout.** If you invoke synchronously through something with a shorter timeout, that timeout wins. This is why I'm using SQS and not an API.
- **It only applies to invocations that start after you change it.** An event source mapping can take a few minutes to pick it up.

I'd keep an eye on the Kafka one. Existing mappings won't break but they also won't get the new limit, and you won't get a warning about it.

## How it fits together

![Architecture: a message on an SQS queue triggers a Lambda with a 1,800s timeout, which fetches the season CSV from football-data.co.uk and writes results to S3, with a dead-letter queue after 2 failed receives](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-architecture.png)

The setup is pretty simple. A message on the queue says which team and season to simulate, a Lambda picks it up, pulls the season's CSV, runs for 20 minutes or so and writes a JSON file to S3. Anything that fails twice ends up in the DLQ.

I went with SQS rather than API Gateway or a function URL, as I didn't want to hold an HTTP connection open for 20 minutes. The queue also gives me retries and a DLQ without any extra work.

## The simulation

I'm not a data scientist, so the model is simple. It's the [Maher (1982)](https://en.wikipedia.org/wiki/Poisson_regression) approach that a lot of football models start from. Every team gets an **attack** and a **defence** rating, and there's one **home advantage** number:

```
home goals ~ Poisson(home_adv * attack[home] * defence[away])
away goals ~ Poisson(attack[away] * defence[home])
```

The ratings are fitted from this season's results. Then every remaining fixture is played out with random goals, the table gets built and I record where United finished. Do that enough times and you get a probability for every position.

I added two things to make it a bit more realistic, which also made it slow:

1. **Bootstrapping.** Eleven games in, nobody really knows how good anyone is. So rather than fitting once, I resample the played matches, refit the ratings and simulate from those. I do that 3,000 times.
2. **The big games.** For each of United's remaining fixtures I track the odds if they win and if they lose. The gap between the two is that game's *swing*. It uses the same simulations, but it needs a lot of them before the numbers stop jumping around.

That's 3,000 fits × 10,000 seasons = **30 million simulated seasons** per request.

I started with 2,000 fits, but a quick smoke test showed Lambda doing about 0.42 seconds per fit. 2,000 would have finished in around 14 minutes, which is under the old limit and would've made this post a bit pointless. So I went with 3,000, which took 21 minutes.

30 million is probably overkill, but the swing figures only use a third of the simulations each, and they jump around a lot below a few million. In testing, the top 4 odds moved by 8% between 50 and 100 fits on the same data, so I stuck with the bigger number.

The core of the handler, with the full file in the repo:

```python
def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            job = json.loads(record["body"])
            key = f"results/{job['request_id']}.json"

            # Idempotency: SQS is at-least-once and a 30 minute run is a big
            # window for a duplicate. If the result already exists, skip.
            try:
                s3.head_object(Bucket=RESULTS_BUCKET, Key=key)
                log.info("Result %s already exists, skipping duplicate", key)
                continue
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
                    raise

            result = run(job, context)
            try:
                # If-None-Match: * means a racing duplicate can't overwrite us
                s3.put_object(Bucket=RESULTS_BUCKET, Key=key, IfNoneMatch="*",
                              Body=json.dumps(result, indent=2),
                              ContentType="application/json")
            except ClientError as e:
                if e.response["Error"]["Code"] != "PreconditionFailed":
                    raise
        except Exception:
            log.exception("Failed processing message %s", record["messageId"])
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

The loop also checks how much time is left. If there's less than a minute to go it stops early and writes what it has, so the function doesn't get killed at 1,800 seconds with nothing saved:

```python
for b in range(bootstrap_fits):
    if context.get_remaining_time_in_millis() < SAFETY_MARGIN_MS:
        log.warning("Stopping early at fit %d/%d to avoid timeout", b, bootstrap_fits)
        break
    sample = rng.integers(0, len(played), len(played))
    att, dfn, home = fit(hi[sample], ai[sample], hg[sample], ag[sample], n)
    pos, res = simulate(att, dfn, home, base_pts, base_gd, fx_h, fx_a, sims_per_fit, rng, t)
    ...
```

Something I got wrong first time: some bootstrap samples leave a team with zero goals scored. That gives an attack rating of 0, numpy divides by it and the whole thing falls over at `rng.poisson()` with `lam value too large`.

To fix it I added a small prior, where every team gets a couple of pretend matches against an average side. It also stops the model overrating a team that had a good first month.

I didn't need a fixtures feed either. Every team plays every other team home and away, so any pairing not in the results yet is still to come.

## The Terraform

The AWS post only shows CLI and SAM examples, so here it is in Terraform. CloudFormation fans, I'm one of you, but Terraform is what we use in work.

There are four pieces: a results bucket, a queue with a DLQ, the function and the event source mapping. I've skipped the boring bits here (IAM, log group etc.) but they're all in the repo.

The first gotcha is with the queue:

```hcl
locals {
  # AWS guidance: SQS visibility timeout >= 6x the function timeout.
  # For a 30 minute function that's 3 hours. Lambda itself only enforces
  # visibility >= 1x the timeout, and only when the event source mapping is
  # created or updated - raising the function timeout later isn't checked.
  visibility_timeout = var.timeout_seconds * 6
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.name}-jobs"
  visibility_timeout_seconds = local.visibility_timeout
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 2
  })
}
```

This is the main thing to watch out for. AWS recommends 6x, but it's only a recommendation. What Lambda actually enforces is that the visibility timeout is at least the function timeout, and it only checks that when the mapping is created or updated.

So a queue at 900 seconds was perfectly valid for a 15 minute function. Bump that function to 1800 and nothing complains, but at minute 15 the message becomes visible again and a second invocation picks up the same job.

I've tied both values to the one variable so they always change together.

The function:

```hcl
resource "aws_lambda_function" "sim" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "handler.handler"
  runtime          = "python3.14"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  # The AWS provider still validates timeout as 1-900, see below
  timeout     = 900
  memory_size = 1769 # one full vCPU - numpy here is single threaded so more won't help

  # Cap how many 30 minute runs can be going at once (and the bill).
  reserved_concurrent_executions = 5

  environment {
    variables = {
      RESULTS_BUCKET   = aws_s3_bucket.results.bucket
      SAFETY_MARGIN_MS = "60000"
    }
  }

  lifecycle {
    ignore_changes = [timeout]
  }
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn        = aws_sqs_queue.jobs.arn
  function_name           = aws_lambda_function.sim.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 5
  }
}
```

### The Terraform provider doesn't know about 30 minutes yet

This one caught me out when I went to deploy. My first `terraform apply` with `timeout = 1800` failed straight away on the latest AWS provider (v6.73.0):

```
Error: expected timeout to be in the range (1 - 900), got 1800

  with aws_lambda_function.sim,
  on main.tf line 147, in resource "aws_lambda_function" "sim":
 147:   timeout     = var.timeout_seconds
```

The provider has its own validation hardcoded at 900 seconds, so it never even gets to the Lambda API.

If you read my [CloudFormation vs. Terraform](https://redm0nd.github.io/2024/03/18/CFN-vs-TF.html) post you'll know this isn't new. Features tend to land in Terraform a while after launch, and to be fair this one was only announced four days ago.

The workaround until the provider catches up is to create the function at 900, then bump it with the AWS CLI. `ignore_changes` stops Terraform flipping it back on the next apply:

```hcl
resource "terraform_data" "lambda_timeout" {
  triggers_replace = [var.timeout_seconds, aws_lambda_function.sim.source_code_hash]

  provisioner "local-exec" {
    command = <<-EOT
      aws lambda wait function-updated-v2 --region ${var.region} --function-name ${aws_lambda_function.sim.function_name}
      aws lambda update-function-configuration --region ${var.region} --function-name ${aws_lambda_function.sim.function_name} --timeout ${var.timeout_seconds} --query Timeout
      aws lambda wait function-updated-v2 --region ${var.region} --function-name ${aws_lambda_function.sim.function_name}
    EOT
  }
}
```

The event source mapping also gets a `depends_on = [terraform_data.lambda_timeout]` so SQS doesn't start invoking the function while it's still at 15 minutes.

It's a bit of a hack, but it works and you can remove it once the provider supports 1800. CloudFormation and SAM don't have this problem as they pass the value straight through to the API.

Some other settings in there:

- **`memory_size = 1769`** is where Lambda gives you one full vCPU. The simulation is single threaded, so going to 4 GB would mostly just cost more.
- **`batch_size = 1`**, because 10 jobs at 20 minutes each won't fit in any timeout.
- **`reserved_concurrent_executions = 5`**, as a long function ties up concurrency for a long time. More on that below.
- **arm64**, because Graviton is cheaper per GB-second and numpy ships aarch64 wheels.

numpy needs to be packaged for the right platform. Build the zip on a Mac and ship it and you'll get an `ImportError` at runtime, so `build.sh` handles that:

```bash
pip install numpy \
  --platform manylinux_2_28_aarch64 \
  --python-version 3.14 \
  --only-binary=:all: \
  --target build
cp src/handler.py build/
```

## Deploy and run it

```bash
git clone https://github.com/Redm0nd/mufc-montecarlo.git && cd mufc-montecarlo
bash build.sh
cd terraform
terraform init
terraform apply -var region=eu-west-1
```

I deployed from CloudShell, which brought up one more small gotcha. The home directory is only 1GB and the AWS provider alone is several hundred MB, so `terraform init` failed with `no space left on device`. Pointing Terraform's data dir at `/tmp` sorts it:

```bash
export TF_DATA_DIR=/tmp/tfdata
```

Once it's applied, the console shows the function at 30 minutes:

![Lambda console showing the mufc-montecarlo function with an SQS trigger, 1769 MB memory and a 30 min timeout](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/lambda-config-30min.png)

Then drop a job on the queue. `2627` is football-data.co.uk's code for the 2026/27 season:

```bash
aws sqs send-message \
  --queue-url "$(terraform output -raw queue_url)" \
  --message-body '{"request_id":"mufc-2026-11-23","season":"2627","team":"Man United","bootstrap_fits":3000,"sims_per_fit":10000,"seed":2026}'
```

Watch it go. The handler logs progress every 25 fits:

```bash
aws logs tail /aws/lambda/mufc-montecarlo --follow
```

```
2026-11-23T20:11:41 [INFO] fit 1025/3000 done, 439s elapsed, 1360s left
2026-11-23T20:11:52 [INFO] fit 1050/3000 done, 450s elapsed, 1350s left
[...]
2026-11-23T20:25:40 [INFO] fit 3000/3000 done, 1278s elapsed, 521s left
2026-11-23T20:25:40 [INFO] Wrote s3://mufc-montecarlo-results-<account-id>/results/mufc-2026-11-23.json p_top_4=0.000
2026-11-23T20:25:40 REPORT RequestId: 761afe94-b281-525b-b45d-9dea2cf6df7e Duration: 1278417.90 ms Billed Duration: 1278418 ms Memory Size: 1769 MB Max Memory Used: 197 MB
```

![CloudWatch log lines showing fit 3000/3000 done and a REPORT line with Duration 1278417.90 ms](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/lambda-report-21min.png)

The REPORT line shows 1,278,417 ms, so just over 21 minutes in a single invocation. Before November 19th that would've died at 900,000 ms.

Max memory used was only 197 MB, so the 1,769 MB is only there for the vCPU.

Grab the result:

```bash
aws s3 cp "s3://$(terraform output -raw results_bucket)/results/mufc-2026-11-23.json" - | jq '{p_top_4, p_top_6, p_title, expected_position, elapsed_seconds}'
```

To check idempotency, send the exact same message again. You should see `already exists, skipping duplicate` in the logs within a second or two, and no second 20 minute bill.

## So, can United make the top 4?

No, but at least now there's a number on it. This is straight from the Lambda run, with 109 matches played (Everton v Brentford still to come):

```json
{
  "simulations": 30000000,
  "elapsed_seconds": 1278.1,
  "current_points": 8,
  "p_title": 0.00000067,
  "p_top_4": 0.00038,
  "p_top_6": 0.0031,
  "p_relegation": 0.439,
  "expected_position": 16.41,
  "bootstrap_fits_completed": 3000
}
```

| Outcome | Probability | Roughly |
| --- | --- | --- |
| Win the league | 0.00007% | 20 times in 30 million seasons |
| Top 4 | 0.04% | 1 in 2,600 |
| Top 6 | 0.31% | 1 in 330 |
| Stay up (17th or better) | 56.1% | |
| Relegated | 43.9% | |
| Finish bottom | 15.0% | 1 in 7 |

![Bar chart of Man United's finishing position across 30 million simulated seasons, peaking at 19th, with 43.9% in the relegation places](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-finishing-position.png)

So that's **1 in 2,600** for the top 4. The more worrying number is **44% for relegation**, and 19th is their most likely finish.

With the top 4 gone, the big games are really about staying up. I added relegation odds for a win, draw or loss in every remaining fixture (one more counter in the same loop, no extra simulations). These are the six-pointers:

| Fixture | Relegated if win | if draw | if loss | Swing (win v loss) |
| --- | --- | --- | --- | --- |
| Man United v Crystal Palace | 33% | 53% | 63% | 30% |
| Man United v Coventry | 31% | 50% | 61% | 30% |
| Coventry v Man United | 27% | 44% | 56% | 29% |
| Ipswich v Man United | 26% | 43% | 55% | 29% |
| Crystal Palace v Man United | 29% | 47% | 57% | 28% |

![Chart of United's relegation odds if they win, draw or lose each of their six biggest remaining games](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-six-pointers.png)

Unsurprisingly they're all against the teams around them. If they beat Palace at home the chance of going down drops to about a third, and if they lose it's nearly two in three. So around 30% (percentage points) on one game.

### Could City save United?

In September an independent commission [found Man City guilty on 114 of the 115 charges](https://www.aljazeera.com/sports/2026/9/25/man-city-found-guilty-on-almost-all-115-premier-league-charges-report). City have appealed and the [appeal is due to be heard by January](https://www.aljazeera.com/sports/2026/10/14/manchester-city-appeal-over-charges-to-be-heard-by-january-says-regulator). No sanction has been announced yet, but [one report](https://www.football365.com/news/man-city-ffp-likely-point-deduction-three-pronged-punishment) reckons a deduction of around 50 points is likely.

It's all hypothetical for now, but it's an easy what-if to run. I added a `points_adjustments` option to the job and sent one more message:

```json
{"request_id":"mufc-2026-11-23-city-minus-50","season":"2627","team":"Man United",
 "bootstrap_fits":1000,"sims_per_fit":10000,"seed":2026,
 "points_adjustments":{"Man City":-50}}
```

| Scenario | Relegated | Finish bottom | Expected position |
| --- | --- | --- | --- |
| As things stand | 43.9% | 15.0% | 16.4 |
| City docked 50 points | 30.7% | 2.4% | 15.4 |

So a City deduction would knock about 13% off United's relegation odds, mostly because City would almost certainly finish bottom instead. It's still nearly one in three though.

Imagine both Manchester clubs in the Championship next season...

This run was 10 million seasons in under 9 minutes. The same function handles the 21 minute job and the 9 minute one, with no chunking logic for either.

Usual caveat: it's a simple model. It knows nothing about injuries, the manager or the January window, and it's judging United on 11 games of genuinely bad football. Please don't use it for betting! Personally, I'm hoping it's wrong.

## Gotchas to watch out for

Most of these won't matter for a function that runs for 30 seconds, but they start to at 30 minutes.

**1. Visibility timeout.** I covered this above, but I think it's the one most likely to catch people out. If you raise the function timeout later, nothing re-checks it.

**2. Concurrency.** Concurrency is request rate × duration. One request a second at 30 minutes needs **1,800** concurrent executions, which is more than the usual 1,000 per region (newer accounts often start lower).

Every other function in the account shares that pool, so I set `reserved_concurrent_executions` and `maximum_concurrency`. That way a burst of 50 messages waits in the queue instead of using up all the concurrency.

**3. Retries get expensive.** With `maxReceiveCount = 2`, a job that fails at minute 28 runs again before it lands in the DLQ. That's up to an hour of compute for one bad message. A typo in the team name will never succeed, so it's better to validate that up front.

**4. Idle connections.** Not an issue here as the function isn't in a VPC. But behind a NAT gateway, idle connections get dropped after 350 seconds, so a DB connection opened at minute 1 will be dead by minute 25. Use keep-alives or reconnect.

**5. Credentials.** The execution role is fine. If you assume another role or grab a token at the start, check it lasts 30 minutes.

**6. Duplicates.** SQS is at-least-once and a longer run is a longer window for a duplicate. That's why the handler checks S3 first and writes with `IfNoneMatch="*"`, so if two copies race only one wins.

I'd usually reach for [Powertools idempotency](https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/) with DynamoDB, but for one output file per job, S3 conditional writes are enough and I don't need an extra table.

## Cost

**checks AWS bill** The 21 minute run works out at roughly 2,200 GB-seconds. At the standard [$0.0000166667 per GB-second](https://aws.amazon.com/lambda/pricing/) that's under **4 cents** a run, and arm64 is cheaper again. The free tier would cover around 180 of these a month.

Fargate might be slightly cheaper, but then you've a cluster, a task definition, an image in ECR and something to trigger it. For a job that runs a few times a week I'd rather just have the Lambda.

## When I wouldn't use this

- **Anything user-facing over HTTP.** Web Functions are still 15 minutes, and nobody's waiting 20 minutes for a response anyway.
- **Jobs that might go past 30 minutes.** Look at [durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) or Managed Instances (90 minutes async). I wouldn't build something that runs at 29 minutes and hope for the best.
- **Steady, constant load.** If it runs all day, every day, Managed Instances or containers will likely be cheaper.

## Clean up

```bash
cd terraform
terraform destroy
```

The bucket has `force_destroy = true` so the results go with it. Download them first if you want to keep them.

## Conclusion

I'm a big fan of this change. A lot of jobs I'd have put on Fargate or Batch can now just be a Lambda function.

Just keep an eye on the visibility timeout, concurrency, retries and duplicates, as AWS won't warn you about most of them. And if you're using Terraform, you'll need the workaround above until the provider is updated.

Next I want to try the same job as a durable function with a checkpoint every 100 fits and see if I can push it past 30 minutes. I'll look at that in a future post...

PS: Remember to `terraform destroy` when you're done!
