import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { entireCommand, gitCommand, safeRepoUrl, serverHost, workspaceHost } from '../src/worker/hosts.mjs'

test('WSL UNC paths map to a distro and a Linux path', () => {
  assert.deepEqual(workspaceHost('\\\\wsl.localhost\\Ubuntu\\home\\peterc\\ccw'), {
    kind: 'wsl',
    distro: 'Ubuntu',
    path: '/home/peterc/ccw'
  })
  assert.deepEqual(workspaceHost('\\\\wsl$\\Ubuntu-22.04\\home\\me\\app'), {
    kind: 'wsl',
    distro: 'Ubuntu-22.04',
    path: '/home/me/app'
  })
  assert.deepEqual(workspaceHost('//wsl.localhost/Ubuntu/home/me'), { kind: 'wsl', distro: 'Ubuntu', path: '/home/me' })
})

test('other paths stay local', () => {
  for (const path of ['C:/Users/pcruc/Web Projects/orca-entire-extension', 'C:\\repo', '/Users/me/repo']) {
    assert.deepEqual(workspaceHost(path), { kind: 'local', path })
  }
})

test('WSL commands keep each argument intact', () => {
  const { command, args } = entireCommand({ kind: 'wsl', distro: 'Ubuntu', path: '/home/me/a b' }, [
    'trail',
    'comment',
    'two words'
  ])
  assert.equal(command, 'wsl.exe')
  assert.deepEqual(args, [
    '-d',
    'Ubuntu',
    '--cd',
    '/home/me/a b',
    '-e',
    'bash',
    '-lc',
    'exec entire "$@"',
    'entire',
    'trail',
    'comment',
    'two words'
  ])
})

test('local commands run entire in the workspace', () => {
  assert.deepEqual(entireCommand({ kind: 'local', path: 'C:/repo' }, ['status', '--json']), {
    command: 'entire',
    args: ['status', '--json'],
    cwd: 'C:/repo'
  })
})

test("a paired server's workspace reads Entire from here, outside any checkout", () => {
  const host = serverHost({ environment: 'Endo VPS Server', path: '/home/ubuntu', repoUrl: 'git@github.com:petercr/endo.chat_backend.git', branch: 'main' })
  assert.equal(host.repo, 'git@github.com:petercr/endo.chat_backend.git')
  assert.deepEqual(entireCommand(host, ['trail', 'show']), { command: 'entire', args: ['trail', 'show'], cwd: tmpdir() })
  assert.throws(() => gitCommand(host, ['status']), /only on Endo VPS Server/)
})

test('only plain remote URLs reach Entire as --repo', () => {
  for (const url of ['git@github.com:petercr/leadgen.git', 'https://github.com/petercr/leadgen.git', 'entire://aws-us-east-2.entire.io/et/entire-repos/x', 'ssh://git@host:22/a/b.git']) {
    assert.equal(safeRepoUrl(url), url)
  }
  for (const url of [null, '', '--upload-pack=x', '-o@x:y', 'https://a b', '/home/ubuntu/repo', 'git@host:a\nb']) {
    assert.equal(safeRepoUrl(url), null)
  }
})